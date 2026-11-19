"""Create the shared OpenAI workspace venv and install its baseline packages."""

import argparse
import os
from pathlib import Path
import subprocess
import sys
import venv


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--workspace', type=Path, default=Path.cwd() / '.openai-service-workspace')
    args = parser.parse_args()
    environment = args.workspace.resolve() / '.python-env'
    python = environment / ('Scripts/python.exe' if os.name == 'nt' else 'bin/python')
    if sys.version_info < (3, 10):
        parser.error('Python 3.10 or newer is required')
    if environment.exists() and not (environment / 'pyvenv.cfg').is_file():
        parser.error(f'{environment} exists without pyvenv.cfg')
    # Refresh the interpreter and activation scripts for this machine when rerun.
    venv.EnvBuilder(with_pip=True).create(environment)
    requirements = Path(__file__).resolve().parents[1] / 'requirements-python.txt'
    subprocess.run([str(python), '-m', 'pip', 'install', '-r', str(requirements)], check=True)
    subprocess.run([str(python), '-m', 'pip', 'check'], check=True)
    print(f'Shared Python: {python}')


if __name__ == '__main__':
    main()
