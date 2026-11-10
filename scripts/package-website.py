#!/usr/bin/env python3
import shutil
import sys
import tarfile
import tempfile
from pathlib import Path

if len(sys.argv) != 2:
    sys.exit('Usage: package-website.py OUTPUT.tar.gz (run from the repository root after npm run build)')
with tempfile.TemporaryDirectory(prefix='bustrackr-package-') as staging:
    website = Path(staging) / 'website'
    shutil.copytree('website', website)
    shutil.copy2('website/index.html', website / 'about.html')
    shutil.copytree('dist', website, dirs_exist_ok=True)
    with tarfile.open(sys.argv[1], 'w:gz') as archive:
        archive.add(website, 'website')
