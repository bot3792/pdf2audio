"""JSON-lines embedding server: {"id", "texts": [...]} in, {"id", "vectors": [[...]]} out."""
import json
import sys

from FlagEmbedding import BGEM3FlagModel

model = BGEM3FlagModel("BAAI/bge-m3", use_fp16=True)
print(json.dumps({"type": "ready"}), flush=True)

for line in sys.stdin:
    line = line.strip()
    if not line:
        continue
    req = json.loads(line)
    try:
        result = model.encode(req["texts"], batch_size=16, max_length=1024)
        vectors = [vec.tolist() for vec in result["dense_vecs"]]
        print(json.dumps({"id": req["id"], "vectors": vectors}), flush=True)
    except Exception as exc:  # noqa: BLE001 - report to the caller, keep serving
        print(json.dumps({"id": req["id"], "error": str(exc)}), flush=True)
