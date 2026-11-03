#!/usr/bin/env python3
import argparse
import contextlib
import ctypes
import fcntl
import hashlib
import io
import json
import os
from pathlib import Path
import re
import select
import shutil
import subprocess
import sys
import tarfile
import time
import urllib.request
import uuid

REPOSITORY = 'https://github.com/Valley-Christian-Startup-Incubator/BusTrackr.git'
PUBLIC_URLS = ('https://bustrackr.valleychristianai.com', 'https://bustracker.valleychristianai.com')
ASSET = re.compile(r'^.+\.([a-f0-9]{16})\.(css|js)$')
VITE_ASSET = re.compile(r'^(?:BusTrackr/)?assets/.+-[A-Za-z0-9_-]{8,}\.[A-Za-z0-9]+$')
PAGES = ('index.html', 'privacy.html', 'support.html')
HEALTH_HEADERS = {'User-Agent': 'Mozilla/5.0 BusTrackr-Deployment-Health/1.0', 'Cache-Control': 'no-cache'}


def run(*args, cwd=None):
    return subprocess.check_output(args, cwd=cwd, text=True, stderr=subprocess.PIPE).strip()


def atomic_json(path, value):
    temporary = path.with_name(path.name + '.next')
    with temporary.open('w') as handle:
        json.dump(value, handle, indent=2)
        handle.flush()
        os.fsync(handle.fileno())
    os.replace(temporary, path)
    descriptor = os.open(path.parent, os.O_RDONLY)
    try:
        os.fsync(descriptor)
    finally:
        os.close(descriptor)


def exchange(left, right):
    library = ctypes.CDLL(None, use_errno=True)
    if sys.platform == 'darwin':
        function, directory = library.renameatx_np, -2
    elif sys.platform.startswith('linux') and hasattr(library, 'renameat2'):
        function, directory = library.renameat2, -100
    else:
        raise RuntimeError('Atomic directory adoption is unsupported on this platform')
    function.argtypes = (ctypes.c_int, ctypes.c_char_p, ctypes.c_int, ctypes.c_char_p, ctypes.c_uint)
    function.restype = ctypes.c_int
    if function(directory, os.fsencode(left), directory, os.fsencode(right), 2):
        raise OSError(ctypes.get_errno(), 'Atomic directory exchange failed')
    descriptor = os.open(Path(right).parent, os.O_RDONLY)
    try:
        os.fsync(descriptor)
    finally:
        os.close(descriptor)


class Deployer:
    def __init__(self, root, repository=REPOSITORY, public_urls=PUBLIC_URLS, node='node', handler=None):
        self.root = Path(root).resolve()
        self.home = self.root / 'deploy-website'
        self.releases = self.home / 'releases'
        self.live = self.root / 'website'
        self.state_file = self.home / 'state.json'
        self.repository = repository
        self.public_urls = public_urls
        self.node = node
        self.handler = Path(handler).resolve() if handler else self.root / 'server' / ('frontend.mjs' if (self.root / 'server/frontend.mjs').exists() else 'website.mjs')
        self.releases.mkdir(parents=True, exist_ok=True)

    @contextlib.contextmanager
    def locked(self):
        with (self.home / 'lock').open('a') as handle:
            try:
                fcntl.flock(handle, fcntl.LOCK_EX | fcntl.LOCK_NB)
            except BlockingIOError:
                yield False
                return
            self.recover()
            yield True

    def state(self):
        if not self.state_file.exists():
            return {}
        return json.loads(self.state_file.read_text())

    def save(self, state):
        atomic_json(self.state_file, state)

    def point(self, release):
        temporary = self.root / ('.website-next-' + uuid.uuid4().hex)
        temporary.symlink_to(release['path'], target_is_directory=True)
        os.replace(temporary, self.live)
        descriptor = os.open(self.root, os.O_RDONLY)
        try:
            os.fsync(descriptor)
        finally:
            os.close(descriptor)

    def recover(self):
        state = self.state()
        pending = state.get('pending')
        if not pending:
            return
        if self.live.is_symlink() and self.live.resolve() == Path(pending['after']['path']).resolve():
            self.restore(pending['before'])
        before = pending['before']
        if before['commit'] == 'legacy' and not self.live.is_symlink():
            staging = Path(before['path'])
            if staging.is_symlink():
                staging.unlink()
            before = {'commit': 'legacy', 'path': str(self.live)}
        state['active'] = before
        state['previous'] = pending.get('previous')
        state['failed_commit'] = pending['after']['commit']
        state.pop('pending')
        self.save(state)

    def restore(self, release):
        path = Path(release['path'])
        if release['commit'] == 'legacy' and path != self.live and not path.is_symlink():
            exchange(path, self.live)
        elif path != self.live:
            self.point(release)

    def fetch(self):
        source = self.home / 'source.git'
        if not source.exists():
            run('git', 'clone', '--bare', self.repository, str(source))
        if run('git', 'remote', 'get-url', 'origin', cwd=source) != self.repository:
            raise RuntimeError('Deployment repository changed; refusing to fetch')
        if run('git', 'rev-parse', '--is-bare-repository', cwd=source) != 'true':
            raise RuntimeError('Deployment source must be a bare repository')
        run('git', 'fetch', '--no-tags', 'origin', 'refs/heads/main:refs/remotes/origin/main', cwd=source)
        commit = run('git', 'rev-parse', 'refs/remotes/origin/main', cwd=source)
        baseline = self.state().get('source_tip')
        if baseline:
            run('git', 'merge-base', '--is-ancestor', baseline, commit, cwd=source)
        return source, commit

    def retain_assets(self, candidate):
        registry = self.home / 'assets'
        registry.mkdir(exist_ok=True)
        roots = [candidate]
        if self.live.is_dir():
            roots.append(self.live.resolve())
        for root in roots:
            for asset in root.rglob('*'):
                relative = asset.relative_to(root)
                match = ASSET.fullmatch(str(relative))
                if not match and not VITE_ASSET.fullmatch(str(relative)):
                    continue
                if not asset.is_file() or asset.is_symlink():
                    raise RuntimeError('Versioned asset must be a regular file')
                data = asset.read_bytes()
                if match and hashlib.sha256(data).hexdigest()[:16] != match[1]:
                    raise RuntimeError('Versioned asset hash mismatch: ' + str(relative))
                destination = registry / relative
                destination.parent.mkdir(parents=True, exist_ok=True)
                if destination.exists():
                    if destination.read_bytes() != data:
                        raise RuntimeError('Versioned asset collision: ' + str(relative))
                else:
                    temporary = destination.with_name(destination.name + '.next')
                    temporary.write_bytes(data)
                    os.replace(temporary, destination)
        for root in roots:
            for asset in registry.rglob('*'):
                if not asset.is_file():
                    continue
                destination = root / asset.relative_to(registry)
                destination.parent.mkdir(parents=True, exist_ok=True)
                if not destination.exists():
                    os.link(asset, destination)

    def validate(self, release, commit):
        root = release / 'website'
        for path in root.rglob('*'):
            if path.is_symlink() or any(part.startswith('.') for part in path.relative_to(root).parts):
                raise RuntimeError('Private files and symlinks are not website assets')
            if path.is_file() and path.suffix.lower() not in {'.html', '.css', '.js', '.svg', '.png', '.webp', '.jpg', '.jpeg', '.ico', '.json', '.glb', '.gltf', '.bin', '.wasm', '.webmanifest', '.woff', '.woff2', '.ttf', '.txt', '.md'}:
                raise RuntimeError('Unexpected public asset: ' + path.name)
        pages = list(PAGES)
        root_map = (root / 'manifest.webmanifest').exists()
        if ((self.live / 'BusTrackr/index.html').exists() or (self.live / 'manifest.webmanifest').exists()) and not ((root / 'BusTrackr/index.html').exists() or root_map):
            raise RuntimeError('Candidate would remove the self-hosted map')
        if (root / 'BusTrackr/index.html').exists():
            pages.append('BusTrackr/index.html')
        if (root / 'about.html').exists():
            pages.append('about.html')
        for name in pages:
            html = (root / name).read_text()
            for target in re.findall(r'(?:src|href)=[\'"]([^\'"?#]+)', html):
                if re.match(r'^[a-z]+:', target) or target.startswith('//'):
                    continue
                path = root / target.lstrip('/') if target.startswith('/') else (root / name).parent / target
                if not path.exists() or not path.resolve().is_relative_to(root.resolve()):
                    raise RuntimeError('Missing local website asset: ' + target)
            html = re.sub(r'<meta name="bustrackr-release"[^>]*>\s*', '', html)
            (root / name).write_text(html.replace('</head>', f'<meta name="bustrackr-release" content="{commit}">\n</head>'))
        validator = release / 'scripts/version-website-assets.mjs'
        if validator.exists():
            run(self.node, str(validator), '--check')
        self.retain_assets(root)
        preview = '''import {createServer} from 'node:http';
import {pathToFileURL} from 'node:url';
const handler=await import(pathToFileURL(process.argv[2]));
const server=handler.createFrontend ? handler.createFrontend({root:process.argv[3],upstreamHost:'127.0.0.1',upstreamPort:18787}) : createServer(async(req,res)=>{if(!await handler.serveWebsite(req,res,process.argv[3])){res.statusCode=404;res.end();}});
server.listen(0,'127.0.0.1',()=>console.log(server.address().port));'''
        process = subprocess.Popen([self.node, '--input-type=module', '-e', preview, 'bustrackr-preview', str(self.handler), str(root)], stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
        try:
            if not select.select([process.stdout], [], [], 10)[0]:
                raise RuntimeError('Candidate preview did not start')
            port = process.stdout.readline().strip()
            if not port.isdigit():
                raise RuntimeError('Candidate preview failed')
            self.probe((f'http://127.0.0.1:{port}',), commit)
            self.probe_map(f'http://127.0.0.1:{port}', root, commit)
        finally:
            process.terminate()
            try:
                process.wait(timeout=5)
            except subprocess.TimeoutExpired:
                process.kill()
                process.wait()
            process.stdout.close()
            process.stderr.close()

    def probe(self, urls=None, commit=None):
        for base in self.public_urls if urls is None else urls:
            paths = ('/', '/privacy.html', '/support.html') if commit else ('/', '/api/health')
            for path in paths:
                request = urllib.request.Request(base.rstrip('/') + path + ('' if path == '/api/health' else '?release_probe=' + uuid.uuid4().hex), headers=HEALTH_HEADERS)
                with urllib.request.urlopen(request, timeout=10) as response:
                    body = response.read()
                    if response.status != 200:
                        raise RuntimeError('Website probe failed')
                    if commit and f'content="{commit}"'.encode() not in body:
                        raise RuntimeError('Public route has not selected the candidate release')

    def probe_map(self, base, root, commit):
        prefix = '/' if (root / 'manifest.webmanifest').exists() else '/BusTrackr/'
        map_root = root if prefix == '/' else root / 'BusTrackr'
        if not (map_root / 'index.html').exists():
            return
        with urllib.request.urlopen(urllib.request.Request(base.rstrip('/') + prefix + '?release_probe=' + uuid.uuid4().hex, headers=HEALTH_HEADERS), timeout=10) as response:
            if f'content="{commit}"'.encode() not in response.read():
                raise RuntimeError('Map page has not selected the candidate release')
        checks = []
        for suffix, mime in (('.webmanifest', 'json'), ('.glb', 'model/gltf-binary'), ('.json', 'application/json')):
            path = next(map_root.rglob('*' + suffix), None)
            if path:
                checks.append((path, mime))
        for path, mime in checks:
            with urllib.request.urlopen(urllib.request.Request(base.rstrip('/') + prefix + str(path.relative_to(map_root)), headers=HEALTH_HEADERS), timeout=10) as response:
                if mime not in response.headers.get('Content-Type', '') or response.read(64).lstrip().lower().startswith(b'<!doctype html'):
                    raise RuntimeError('Map resource has an invalid content type: ' + str(path))

    def promote(self, after, source_tip=None, adopting=False):
        state = self.state()
        before = state.get('active')
        if adopting and not self.live.is_symlink():
            temporary = self.root / ('.website-legacy-' + uuid.uuid4().hex)
            before = {'commit': 'legacy', 'path': str(temporary)}
        elif not before or not self.live.is_symlink() or self.live.resolve() != Path(before['path']).resolve():
            raise RuntimeError('Adopt the live website before deploying')
        self.probe()
        state['pending'] = {'before': before, 'after': after, 'previous': state.get('previous')}
        self.save(state)
        try:
            if adopting and not self.live.is_symlink():
                temporary.symlink_to(after['path'], target_is_directory=True)
                exchange(temporary, self.live)
            else:
                self.point(after)
            self.probe(commit=after['commit'])
            for base in self.public_urls:
                self.probe_map(base, Path(after['path']), after['commit'])
        except BaseException:
            self.recover()
            raise
        state['active'], state['previous'] = after, before
        state.pop('pending')
        state.pop('failed_commit', None)
        if source_tip:
            state['source_tip'] = source_tip
        self.save(state)
        return after

    def adopt(self):
        if self.live.is_symlink():
            if self.state().get('active'):
                return
            raise RuntimeError('Refusing to adopt an unmanaged website symlink')
        if not self.live.is_dir():
            raise RuntimeError('Live website directory is missing')
        _, baseline = self.fetch()
        commit = 'adopted-' + uuid.uuid4().hex
        release = self.releases / commit
        shutil.copytree(self.live, release / 'website')
        self.validate(release, commit)
        return self.promote({'commit': commit, 'path': str(release / 'website')}, baseline, adopting=True)

    def deploy(self, retry=False):
        if (self.home / 'paused').exists():
            return
        if not self.live.is_symlink() or not self.state().get('active'):
            raise RuntimeError('Run adopt before enabling deployments')
        source, commit = self.fetch()
        state = self.state()
        if not retry and (state.get('source_tip') == commit or state.get('failed_commit') == commit):
            return
        release = self.releases / (commit + '-' + uuid.uuid4().hex[:8])
        release.mkdir()
        try:
            data = subprocess.check_output(['git', 'archive', commit], cwd=source)
            with tarfile.open(fileobj=io.BytesIO(data)) as archive:
                for member in archive.getmembers():
                    if member.issym() or member.islnk() or member.name.startswith('/') or '..' in Path(member.name).parts or not (member.isfile() or member.isdir()):
                        raise RuntimeError('Unsafe release archive entry')
                archive.extractall(release)
            if (release / 'package.json').exists():
                log_path = self.home / ('build-' + commit + '.log')
                with log_path.open('w') as log:
                    os.chmod(log_path, 0o600)
                    runtime = Path(shutil.which(self.node) or self.node).resolve().parent
                    environment = dict(os.environ, VITE_ALERT_API_URL='/api/shuttle', PATH=str(runtime) + os.pathsep + os.environ.get('PATH', ''))
                    subprocess.run(['npm', 'ci', '--ignore-scripts'], cwd=release, env=environment, check=True, stdout=log, stderr=subprocess.STDOUT)
                    if (release / 'mobile/package-lock.json').exists():
                        subprocess.run(['npm', 'ci', '--prefix', 'mobile', '--ignore-scripts'], cwd=release, env=environment, check=True, stdout=log, stderr=subprocess.STDOUT)
                    subprocess.run(['npm', 'run', 'build'], cwd=release, env=environment, check=True, stdout=log, stderr=subprocess.STDOUT)
                self.stage_map(release)
            self.validate(release, commit)
            self.compact(release)
            return self.promote({'commit': commit, 'path': str(release / 'website')}, commit)
        except BaseException:
            self.compact(release)
            state = self.state()
            state['failed_commit'] = commit
            self.save(state)
            raise

    def stage_map(self, release):
        website = release / 'website'
        shutil.copy2(website / 'index.html', website / 'about.html')
        shutil.copytree(release / 'dist', website, dirs_exist_ok=True)

    def compact(self, release):
        for entry in release.iterdir():
            if entry.name == 'website':
                continue
            if entry.is_dir():
                shutil.rmtree(entry)
            else:
                entry.unlink()

    def artifact(self, source):
        source = Path(source).resolve()
        if not source.is_dir() or source == self.live.resolve():
            raise RuntimeError('Artifact must be a separate built website directory')
        commit = 'artifact-' + uuid.uuid4().hex
        release = self.releases / commit
        shutil.copytree(source, release / 'website', symlinks=True)
        self.validate(release, commit)
        return self.promote({'commit': commit, 'path': str(release / 'website')})

    def rollback(self):
        state = self.state()
        previous = state.get('previous')
        if not previous or previous['commit'] == 'legacy':
            raise RuntimeError('No managed previous release; inspect retained legacy directory manually')
        self.retain_assets(Path(previous['path']))
        result = self.promote(previous)
        state = self.state()
        state['failed_commit'] = state['previous']['commit']
        self.save(state)
        return result


def main():
    parser = argparse.ArgumentParser(description='Publish website releases without restarting the camera worker or tunnel')
    parser.add_argument('--root', type=Path, default=Path.home() / 'apps/bustrackr')
    parser.add_argument('--node', default='node')
    parser.add_argument('--handler', type=Path, help='Installed static frontend module used for candidate previews')
    parser.add_argument('command', choices=('adopt', 'deploy', 'status', 'rollback', 'pause', 'resume'))
    parser.add_argument('--retry', action='store_true')
    parser.add_argument('--artifact', type=Path, help='Deploy a separate prebuilt website snapshot, including the root tracker build when present')
    args = parser.parse_args()
    deployer = Deployer(args.root, node=args.node, handler=args.handler)
    with deployer.locked() as acquired:
        if not acquired:
            return
        if args.command == 'status':
            print(json.dumps({**deployer.state(), 'paused': (deployer.home / 'paused').exists(), 'live': str(deployer.live.resolve())}, indent=2))
        elif args.command == 'pause':
            (deployer.home / 'paused').touch()
        elif args.command == 'resume':
            (deployer.home / 'paused').unlink(missing_ok=True)
        else:
            if args.artifact and args.command != 'deploy':
                parser.error('--artifact is only valid with deploy')
            result = deployer.artifact(args.artifact) if args.artifact else deployer.deploy(args.retry) if args.command == 'deploy' else getattr(deployer, args.command)()
            if result:
                print(json.dumps(result))


if __name__ == '__main__':
    try:
        main()
    except (RuntimeError, OSError, subprocess.CalledProcessError) as error:
        print('Website deployment failed: ' + str(error), file=sys.stderr)
        sys.exit(1)
