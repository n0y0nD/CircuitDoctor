"""Save a Gemini key locally, without shell history or terminal echo."""
import getpass
import os
from pathlib import Path
import re
import tempfile
import sys

KEY_FILE = Path(os.environ.get('GEMINI_API_KEY_FILE') or (Path(__file__).resolve().parents[1] / '.gemini-api-key'))


def main():
    if not sys.stdin.isatty():
        raise SystemExit('Run this command directly in your terminal for hidden input.')
    print('Copy the full key from Google AI Studio. Paste with Ctrl+Shift+V, then press Enter.')
    print('No characters or stars will appear while pasting. This is normal.')
    key = getpass.getpass('Gemini API key (hidden): ').strip()
    if not key:
        raise SystemExit('No key was entered. Copy the key, run this command again, and paste with Ctrl+Shift+V before Enter.')
    if not re.fullmatch(r'[A-Za-z0-9._~-]{20,4096}', key):
        raise SystemExit('The input does not look like a complete API key. Copy the full key (not its name or masked preview), without quotes. Nothing saved.')
    fd, temporary = tempfile.mkstemp(prefix='.gemini-key-', dir=KEY_FILE.parent)
    try:
        with os.fdopen(fd, 'w') as stream:
            stream.write(key + '\n')
        os.replace(temporary, KEY_FILE)
    finally:
        Path(temporary).unlink(missing_ok=True)
    print('Gemini key saved locally with owner-only permissions. Key was not displayed.')


if __name__ == '__main__':
    main()
