#!/usr/bin/env python3
import concurrent.futures
import contextlib
import fcntl
import hashlib
import importlib.util
import io
import json
import os
from pathlib import Path
import shutil
import subprocess
import tempfile
import threading
import time
import unittest
import urllib.error
import urllib.request

HERE = Path(__file__).resolve().parent
spec = importlib.util.spec_from_file_location('deploy_website', HERE / 'deploy-website.py')
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)
FRONTEND = '''import {createServer} from 'node:http';
import {pathToFileURL} from 'node:url';
const {createFrontend}=await import(pathToFileURL(process.argv[2]));
const worker=createServer((req,res)=>{
 if(req.url==='/api/health'){res.end('{"status":"connected"}');return;}
 if(req.url==='/api/slow'){res.write('before-');setTimeout(()=>res.end('after'),600);return;}
 res.statusCode=404;res.end();
});worker.listen(0,'127.0.0.1',()=>{
 const server=createFrontend({root:process.argv[3],upstreamPort:worker.address().port});
 server.listen(Number(process.argv[4]),'127.0.0.1',()=>console.log(server.address().port));
});'''


class WebsiteDeploymentTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory(prefix='bustrackr-deploy-test-')
        self.base = Path(self.temporary.name)
        self.root = self.base / 'app'
        self.source = self.base / 'repository'
        self.source.mkdir()
        self.git('init', '-b', 'main')
        self.git('config', 'user.email', 'deployment@example.invalid')
        self.git('config', 'user.name', 'Deployment test')
        (self.source / 'scripts').mkdir()
        shutil.copy2(HERE / 'version-website-assets.mjs', self.source / 'scripts/version-website-assets.mjs')
        (self.source / 'public').mkdir()
        shutil.copy2(HERE.parent / 'public/analytics.js', self.source / 'public/analytics.js')
        (self.source / 'app.html').write_text('<html><head><script defer src="/analytics.js"></script></head><body></body></html>')
        self.write_site('first')
        self.first = self.commit()
        self.root.mkdir()
        shutil.copytree(self.source / 'website', self.root / 'website')
        (self.root / 'server').mkdir()
        shutil.copy2(HERE.parent / 'server/frontend.mjs', self.root / 'server/frontend.mjs')
        self.port = self.start_frontend('0')
        self.url = 'http://127.0.0.1:' + self.port
        self.restarts = 0
        self.deployer = module.Deployer(self.root, repository=str(self.source), public_urls=(self.url,), restart=self.restart_frontend)

    def tearDown(self):
        self.stop_frontend()
        self.temporary.cleanup()

    def start_frontend(self, port):
        self.worker = subprocess.Popen(['node', '--input-type=module', '-e', FRONTEND, 'bustrackr-fixture', str(self.root / 'server/frontend.mjs'), str(self.root / 'website'), port], stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
        return self.worker.stdout.readline().strip()

    def stop_frontend(self):
        self.worker.terminate()
        self.worker.wait(timeout=5)
        self.worker.stdout.close()
        self.worker.stderr.close()

    def restart_frontend(self):
        self.stop_frontend()
        self.start_frontend(self.port)
        self.restarts += 1

    def git(self, *args):
        return module.run('git', *args, cwd=self.source)

    def commit(self):
        self.git('add', '.')
        self.git('commit', '-m', 'website fixture')
        return self.git('rev-parse', 'HEAD')

    def write_site(self, value):
        root = self.source / 'website'
        root.mkdir(exist_ok=True)
        for name, content in [('style.css', 'body{color:' + value + '}'), ('site.js', 'globalThis.release="' + value + '";')]:
            (root / name).write_text(content)
        for name in module.PAGES:
            (root / name).write_text('<!doctype html><html><head><link href="style.css" rel="stylesheet"><script src="analytics.js"></script></head><body>' + value + '<script src="site.js"></script></body></html>')
        module.run('node', str(self.source / 'scripts/version-website-assets.mjs'))

    def request(self, path='/'):
        try:
            with urllib.request.urlopen(self.url + path, timeout=5) as response:
                return response.read().decode()
        except urllib.error.HTTPError as error:
            # Python 3.9, the deploy host's interpreter, does not follow 308 redirects.
            if error.code != 308:
                raise
            return self.request(error.headers['Location'])

    def adopt(self):
        with self.deployer.locked() as acquired:
            self.assertTrue(acquired)
            return self.deployer.adopt()

    def deploy(self):
        with self.deployer.locked() as acquired:
            self.assertTrue(acquired)
            return self.deployer.deploy()

    def handler(self, old='', new=''):
        source = (HERE.parent / 'server/frontend.mjs').read_text()
        self.assertIn(old, source)
        return source.replace(old, new)

    def commit_self_update(self, handler, tests_pass=True):
        (self.source / 'scripts/deploy-website.py').write_text('# controller from this release\n')
        (self.source / 'scripts/test-deploy-website.py').write_text('from pathlib import Path\nwith Path(%r).open("a") as handle:\n    handle.write("ran\\n")\nraise SystemExit(%d)\n' % (str(self.base / 'self-tests'), 0 if tests_pass else 1))
        (self.source / 'server').mkdir(exist_ok=True)
        (self.source / 'server/frontend.mjs').write_text(handler)
        self.write_site('second')
        return self.commit()

    def self_test_runs(self):
        runs = self.base / 'self-tests'
        return len(runs.read_text().splitlines()) if runs.exists() else 0

    def test_live_requests_and_old_assets_survive_deploy_and_rollback(self):
        pid = self.worker.pid
        self.adopt()
        old_asset = 'site.' + hashlib.sha256((self.source / 'website/site.js').read_bytes()).hexdigest()[:16] + '.js'
        self.write_site('second')
        second = self.commit()
        new_asset = 'site.' + hashlib.sha256((self.source / 'website/site.js').read_bytes()).hexdigest()[:16] + '.js'
        failures = []
        stopping = threading.Event()
        def request_continuously():
            while not stopping.is_set():
                try:
                    html = self.request()
                    if 'first' not in html and 'second' not in html:
                        failures.append(html)
                except Exception as error:
                    failures.append(str(error))
        thread = threading.Thread(target=request_continuously)
        thread.start()
        try:
            with concurrent.futures.ThreadPoolExecutor() as executor:
                slow = executor.submit(self.request, '/api/slow')
                time.sleep(.1)
                self.assertEqual(self.deploy()['commit'], second)
                self.assertEqual(slow.result(), 'before-after')
            self.assertIn('second', self.request())
            self.assertIn('first', self.request('/' + old_asset))
            with self.deployer.locked():
                self.deployer.rollback()
            self.assertIn('first', self.request())
            self.assertIn('second', self.request('/' + new_asset))
            self.assertIsNone(self.deploy())
            with self.deployer.locked():
                self.assertEqual(self.deployer.deploy(retry=True)['commit'], second)
            self.assertIn('second', self.request())
            self.assertEqual(self.worker.pid, pid)
            self.assertIsNone(self.worker.poll())
        finally:
            stopping.set()
            thread.join()
        self.assertEqual(failures, [])

    def test_release_installs_its_controller_and_the_handler_its_site_needs(self):
        self.deployer.handler.write_text(self.handler("path+='.html';", 'return false;'))
        self.stop_frontend()
        self.start_frontend(self.port)
        self.adopt()
        (self.source / 'website/app.html').write_text('<html><head></head><body>tracker</body></html>')
        (self.source / 'website/manifest.webmanifest').write_text('{}')
        commit = self.commit_self_update(self.handler())
        with contextlib.redirect_stdout(io.StringIO()) as log:
            self.assertEqual(self.deploy()['commit'], commit)
        self.assertIn('Self-update installed frontend.mjs, controller.py from ' + commit, log.getvalue())
        self.assertEqual((self.deployer.home / 'controller.py').read_text(), '# controller from this release\n')
        self.assertEqual(self.deployer.handler.read_text(), self.handler())
        self.assertEqual(self.restarts, 1)
        self.assertIn('tracker', self.request('/app'))
        self.assertIsNone(self.deploy())
        self.assertEqual((self.self_test_runs(), self.restarts), (1, 1))
        (self.deployer.home / 'controller.py').write_text('# edited by hand\n')
        with contextlib.redirect_stdout(io.StringIO()):
            self.assertIsNone(self.deploy())
        self.assertEqual((self.deployer.home / 'controller.py').read_text(), '# controller from this release\n')
        self.assertEqual((self.self_test_runs(), self.restarts), (2, 1))

    def test_release_whose_self_tests_fail_is_not_installed_or_retried(self):
        self.adopt()
        installed = self.deployer.handler.read_bytes()
        commit = self.commit_self_update(self.handler("res.end('Not found')", "res.end('Missing')"), tests_pass=False)
        with contextlib.redirect_stderr(io.StringIO()) as log:
            self.assertEqual(self.deploy()['commit'], commit)
        self.assertIn('Self-update tests failed for ' + commit, log.getvalue())
        self.assertIn('second', self.request())
        self.assertFalse((self.deployer.home / 'controller.py').exists())
        self.assertEqual(self.deployer.handler.read_bytes(), installed)
        self.assertEqual(self.deployer.state()['self_update_failed'], commit)
        self.assertIsNone(self.deploy())
        self.assertEqual((self.self_test_runs(), self.restarts), (1, 0))

    def test_failed_probe_after_restart_restores_the_previous_handler(self):
        before = self.adopt()
        installed = self.deployer.handler.read_bytes()
        commit = self.commit_self_update(self.handler('{proxy(req,res,upstreamHost,upstreamPort);return;}', '{res.writeHead(502);res.end();return;}'))
        with self.assertRaisesRegex(urllib.error.HTTPError, '502'):
            self.deploy()
        self.assertEqual(self.deployer.handler.read_bytes(), installed)
        self.assertFalse(self.deployer.backup.exists())
        self.assertEqual(self.restarts, 2)
        self.assertEqual(self.request('/api/health'), '{"status":"connected"}')
        self.assertEqual(self.deployer.state()['active'], before)
        self.assertEqual(self.deployer.state()['self_update_failed'], commit)
        self.assertIsNone(self.deploy())
        self.assertEqual(self.restarts, 2)

    def test_interrupted_handler_update_restores_the_previous_handler(self):
        self.adopt()
        installed = self.deployer.handler.read_bytes()
        os.link(self.deployer.handler, self.deployer.backup)
        module.atomic_write(self.deployer.handler, b'interrupted')
        with self.deployer.locked():
            self.assertEqual(self.deployer.handler.read_bytes(), installed)
        self.assertFalse(self.deployer.backup.exists())
        self.assertEqual(self.restarts, 1)

    def test_broken_candidate_handler_is_rejected_before_promotion(self):
        before = self.adopt()
        installed = self.deployer.handler.read_bytes()
        self.commit_self_update(self.handler('if(await staticFile(req,res,root))return;'))
        with self.assertRaisesRegex(urllib.error.HTTPError, '404'):
            self.deploy()
        self.assertEqual(self.deployer.handler.read_bytes(), installed)
        self.assertEqual(self.deployer.state()['active'], before)
        self.assertEqual((self.self_test_runs(), self.restarts), (0, 0))
        self.assertIn('first', self.request())

    def test_broken_release_does_not_change_active_and_is_not_retried(self):
        before = self.adopt()
        (self.source / 'website/privacy.html').unlink()
        bad = self.commit()
        with self.assertRaises(FileNotFoundError):
            self.deploy()
        self.assertEqual(self.deployer.state()['active'], before)
        self.assertEqual(self.deployer.state()['failed_commit'], bad)
        self.assertIsNone(self.deploy())
        self.assertIn('first', self.request())

    def test_failed_adoption_cannot_poison_the_next_attempt(self):
        corrupt = self.root / 'website/extra.0000000000000000.js'
        corrupt.write_text('corrupt asset')
        with self.assertRaisesRegex(RuntimeError, 'asset hash mismatch'):
            self.adopt()
        self.assertFalse(self.deployer.live.is_symlink())
        corrupt.unlink()
        adopted = self.adopt()
        self.assertEqual(self.deployer.state()['active'], adopted)
        self.assertIn('first', self.request())

    def test_map_build_installs_locked_mobile_dependencies(self):
        self.adopt()
        (self.source / 'package.json').write_text('{}')
        (self.source / 'mobile').mkdir()
        (self.source / 'mobile/package-lock.json').write_text('{}')
        self.commit()
        binaries = self.base / 'bin'
        binaries.mkdir()
        node = binaries / 'node'
        node.write_text('#!/bin/sh\nexec ' + shutil.which('node') + ' "$@"\n')
        node.chmod(0o755)
        installed = self.base / 'npm-calls.jsonl'
        npm = binaries / 'npm'
        npm.write_text(r"""#!/usr/bin/env python3
import json
from pathlib import Path
import sys
with Path(%r).open('a') as handle:
    handle.write(json.dumps(sys.argv[1:]) + '\n')
if sys.argv[1:] == ['run', 'build']:
    calls = [json.loads(line) for line in Path(%r).read_text().splitlines()]
    if ['ci', '--prefix', 'mobile', '--ignore-scripts'] not in calls:
        raise SystemExit('Missing expo/tsconfig.base dependency installation')
    Path('dist').mkdir()
    Path('dist/index.html').write_text('<html><head></head><body><div id="root">map fixture</div></body></html>')
    Path('dist/manifest.webmanifest').write_text('{}')
""" % (str(installed), str(installed)))
        npm.chmod(0o755)
        self.deployer.node = str(node)
        self.deploy()
        self.assertIn('map fixture', self.request('/BusTrackr/'))
        self.assertEqual([json.loads(line) for line in installed.read_text().splitlines()], [
            ['ci', '--ignore-scripts'], ['ci', '--prefix', 'mobile', '--ignore-scripts'], ['run', 'build'],
        ])

    def test_corrupt_candidate_cannot_block_a_later_release(self):
        self.adopt()
        corrupt = self.source / 'website/extra.0000000000000000.js'
        corrupt.write_text('corrupt asset')
        self.commit()
        with self.assertRaisesRegex(RuntimeError, 'asset hash mismatch'):
            self.deploy()
        corrupt.unlink()
        self.write_site('second')
        good = self.commit()
        self.assertEqual(self.deploy()['commit'], good)
        self.assertIn('second', self.request())
        artifact = self.base / 'built-site'
        shutil.copytree(self.deployer.live, artifact)
        corrupt = artifact / 'extra.0000000000000000.js'
        corrupt.write_text('corrupt artifact asset')
        with self.deployer.locked(), self.assertRaisesRegex(RuntimeError, 'asset hash mismatch'):
            self.deployer.artifact(artifact)
        corrupt.unlink()
        with self.deployer.locked():
            published = self.deployer.artifact(artifact)
        self.assertEqual(self.deployer.state()['active'], published)
        self.assertIn('second', self.request())

    def test_failed_public_probe_rolls_back(self):
        before = self.adopt()
        self.write_site('second')
        self.commit()
        original = self.deployer.probe
        def probe(urls=None, commit=None):
            if urls is None and commit:
                raise RuntimeError('isolated public probe failure')
            return original(urls, commit)
        self.deployer.probe = probe
        with self.assertRaisesRegex(RuntimeError, 'isolated public probe failure'):
            self.deploy()
        self.assertEqual(self.deployer.state()['active'], before)
        self.assertEqual(self.deployer.live.resolve(), Path(before['path']))
        self.assertIn('first', self.request())

    def test_interrupted_switch_restores_previous_release(self):
        before = self.adopt()
        after = {'commit': 'interrupted', 'path': str(self.base / 'candidate')}
        shutil.copytree(before['path'], after['path'])
        state = self.deployer.state()
        state['pending'] = {'before': before, 'after': after, 'previous': state['previous']}
        self.deployer.save(state)
        self.deployer.point(after)
        with self.deployer.locked():
            self.assertEqual(self.deployer.live.resolve(), Path(before['path']))
        self.assertNotIn('pending', self.deployer.state())
        self.assertEqual(self.deployer.state()['failed_commit'], 'interrupted')

    def test_lock_pause_unchanged_and_repository_guards(self):
        self.adopt()
        with (self.deployer.home / 'lock').open('a') as handle:
            fcntl.flock(handle, fcntl.LOCK_EX | fcntl.LOCK_NB)
            with self.deployer.locked() as acquired:
                self.assertFalse(acquired)
        self.assertIsNone(self.deploy())
        self.write_site('second')
        self.commit()
        (self.deployer.home / 'paused').touch()
        self.assertIsNone(self.deploy())
        (self.deployer.home / 'paused').unlink()
        source = self.deployer.home / 'source.git'
        module.run('git', 'remote', 'set-url', 'origin', '/wrong/repository', cwd=source)
        with self.assertRaisesRegex(RuntimeError, 'repository changed'):
            self.deploy()

    def test_artifact_preserves_map_and_assets_across_rollback(self):
        map_root = self.root / 'website/BusTrackr'
        (map_root / 'assets').mkdir(parents=True)
        (map_root / 'assets/index-abcdefgh.js').write_text('old map')
        (map_root / 'scene.json').write_text('{\"terrain\":true}')
        (map_root / 'bus.glb').write_bytes(b'glTFfixture')
        (map_root / 'manifest.webmanifest').write_text('{\"name\":\"BusTrackr\"}')
        (map_root / 'index.html').write_text('<html><head></head><body><script src="/BusTrackr/assets/index-abcdefgh.js"></script></body></html>')
        self.adopt()
        artifact = self.base / 'built-site'
        shutil.copytree(self.deployer.live, artifact)
        (artifact / 'BusTrackr/assets/index-ijklmnop.js').write_text('new map')
        (artifact / 'BusTrackr/index.html').write_text('<html><head></head><body><script src="/BusTrackr/assets/index-ijklmnop.js"></script></body></html>')
        with self.deployer.locked():
            self.deployer.artifact(artifact)
        self.assertEqual(self.request('/BusTrackr/assets/index-abcdefgh.js'), 'old map')
        with self.deployer.locked():
            self.deployer.rollback()
        self.assertEqual(self.request('/BusTrackr/assets/index-ijklmnop.js'), 'new map')
        shutil.rmtree(artifact / 'BusTrackr')
        with self.deployer.locked(), self.assertRaisesRegex(RuntimeError, 'remove the self-hosted map'):
            self.deployer.artifact(artifact)

    def test_root_tracker_migrates_legacy_map_and_preserves_assets_on_rollback(self):
        legacy = self.root / 'website/BusTrackr'
        (legacy / 'assets').mkdir(parents=True)
        (legacy / 'index.html').write_text('<html><head></head><body>legacy map</body></html>')
        (legacy / 'assets/index-abcdefgh.js').write_text('legacy script')
        self.adopt()
        release = self.base / 'root-release'
        shutil.copytree(self.source / 'website', release / 'website')
        dist = release / 'dist'
        (dist / 'assets').mkdir(parents=True)
        (dist / 'index.html').write_text('<html><head></head><body><div id="root"></div><script src="/assets/index-ijklmnop.js"></script></body></html>')
        (dist / 'assets/index-ijklmnop.js').write_text('root script')
        (dist / 'manifest.webmanifest').write_text('{"name":"BusTrackr"}')
        self.deployer.stage_map(release)
        self.assertIn('first', (release / 'website/about.html').read_text())
        self.assertIn('id="root"', (release / 'website/index.html').read_text())
        with self.deployer.locked():
            self.deployer.artifact(release / 'website')
        self.assertIn('id="root"', self.request())
        self.assertIn('id="root"', self.request('/BusTrackr/?utm_source=instagram'))
        self.assertIn('first', self.request('/about.html'))
        self.assertEqual(self.request('/assets/index-ijklmnop.js'), 'root script')
        self.assertEqual(self.request('/BusTrackr/assets/index-abcdefgh.js'), 'legacy script')
        with self.deployer.locked():
            self.deployer.rollback()
        self.assertIn('legacy map', self.request('/BusTrackr/'))
        self.assertEqual(self.request('/assets/index-ijklmnop.js'), 'root script')

    def test_landing_page_links_to_the_extensionless_tracker_route(self):
        self.adopt()
        release = self.base / 'app-release'
        shutil.copytree(self.source / 'website', release / 'website')
        index = release / 'website/index.html'
        index.write_text(index.read_text().replace('</body>', '<a href="/app">Open the map</a></body>'))
        dist = release / 'dist'
        (dist / 'assets').mkdir(parents=True)
        (dist / 'app.html').write_text('<html><head></head><body><div id="root"></div><script src="/assets/app-ijklmnop.js"></script></body></html>')
        (dist / 'assets/app-ijklmnop.js').write_text('tracker script')
        (dist / 'manifest.webmanifest').write_text('{"name":"BusTrackr"}')
        self.deployer.stage_map(release)
        self.deployer.validate(release, 'f' * 40)
        self.assertIn('content="' + 'f' * 40 + '"', (release / 'website/app.html').read_text())
        with self.deployer.locked():
            self.deployer.artifact(release / 'website')
        self.assertIn('Open the map', self.request())
        self.assertIn('id="root"', self.request('/app'))
        (index).write_text(index.read_text().replace('href="/app"', 'href="/missing"'))
        with self.assertRaisesRegex(RuntimeError, 'Missing local website asset: /missing'):
            self.deployer.validate(release, 'f' * 40)

    def test_interrupted_adoption_before_exchange_keeps_live_directory(self):
        after = {'commit': 'unpromoted', 'path': str(self.base / 'candidate')}
        shutil.copytree(self.root / 'website', after['path'])
        staging = self.root / '.website-legacy-interrupted'
        staging.symlink_to(after['path'])
        self.deployer.save({'pending': {'before': {'commit': 'legacy', 'path': str(staging)}, 'after': after}})
        with self.deployer.locked():
            self.assertFalse(self.deployer.live.is_symlink())
            self.assertEqual(self.deployer.state()['active']['path'], str(self.deployer.live))
        self.assertFalse(staging.exists())
        self.assertIn('first', self.request())

    def test_source_divergence_is_rejected(self):
        self.adopt()
        self.git('checkout', '--orphan', 'replacement')
        self.write_site('replacement')
        self.commit()
        self.git('branch', '-M', 'main')
        with self.assertRaises(subprocess.CalledProcessError):
            self.deploy()
        self.assertIn('first', self.request())


if __name__ == '__main__':
    unittest.main(verbosity=2)
