"""Shared dispatcher for Windows command prompt and Git Bash entry points."""
from pathlib import Path
import runpy
import sys

API_COMMANDS = {
    'api-connect': 'connect',
    'api-oauth': 'oauth-start',
    'api-sync-account': 'sync-account',
    'api-submit': 'submit',
    'api-status': 'status',
    'ad-approve': 'ad-approve',
    'ad-validate': 'ad-validate',
    'ad-submit': 'ad-submit',
    'ad-status': 'ad-status',
    'publish': 'publish',
    'run-due': 'run-due',
}
QUEUE_SCRIPT = Path.home() / '.codex/skills/social-publisher/scripts/social_queue.py'
API_SCRIPT = Path(__file__).with_name('social_api.py')
COMMAND_INDEX = 1

if len(sys.argv) > COMMAND_INDEX and sys.argv[COMMAND_INDEX] in API_COMMANDS:
    sys.argv[COMMAND_INDEX] = API_COMMANDS[sys.argv[COMMAND_INDEX]]
    script = API_SCRIPT
else:
    script = QUEUE_SCRIPT
sys.argv.pop(0)
sys.argv.insert(0, str(script))
sys.path.insert(0, str(script.parent))
runpy.run_path(str(script), run_name='__main__')
