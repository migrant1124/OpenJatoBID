import argparse, json, pathlib

root = pathlib.Path(__file__).resolve().parents[4]
package = json.loads((root / 'client' / 'package.json').read_text(encoding='utf-8'))
parser = argparse.ArgumentParser()
parser.add_argument('command', choices=['inspect'])
parser.add_argument('--json', action='store_true')
args = parser.parse_args()
result = {'version': package['version'], 'expected_tag': f"v{package['version']}", 'brand': 'Jato'}
print(json.dumps(result, ensure_ascii=False) if args.json else result)
