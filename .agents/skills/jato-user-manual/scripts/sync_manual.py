import argparse, hashlib, json

parser = argparse.ArgumentParser()
parser.add_argument('--scope', required=True)
parser.add_argument('--json', action='store_true')
parser.add_argument('--apply', action='store_true')
parser.add_argument('--expected-plan-hash')
args = parser.parse_args()
operations = [{'action': 'sync-manual', 'scope': args.scope, 'mode': 'jato-wiki'}]
plan_hash = hashlib.sha256(json.dumps(operations, ensure_ascii=False, sort_keys=True).encode()).hexdigest()
if args.apply and args.expected_plan_hash != plan_hash:
    raise SystemExit('拒绝写入：expected plan hash 不匹配。')
result = {'dry_run': not args.apply, 'operations': operations, 'plan_hash': plan_hash}
print(json.dumps(result, ensure_ascii=False) if args.json else result)
