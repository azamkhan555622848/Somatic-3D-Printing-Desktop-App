import argparse, json, sys
from coder3d_cad.runner import run_script

def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--script", required=True)
    ap.add_argument("--params-json", default=None)
    ap.add_argument("--reuse", action="store_true",
                    help="carry the previous build's parameter values over (source-edit rebuilds)")
    args = ap.parse_args()
    overrides = json.loads(args.params_json) if args.params_json else None
    m = run_script(args.script, overrides, reuse=args.reuse)
    print(json.dumps(m))
    return 0 if m["error"] is None else 1

if __name__ == "__main__":
    sys.exit(main())
