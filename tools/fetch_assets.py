import json, os, sys, urllib.request, urllib.parse

BASE_PROPS = "assets/props"
BASE_HDRI = "assets/hdri"

MODELS = [
    "old_military_crate",
    "plastic_crate_02",
    "concrete_road_barrier",
    "concrete_road_barrier_02",
    "metal_trash_can",
    "modular_industrial_pipes_01",
    "modular_electric_cables",
    "water_manhole_cover",
    "modular_chainlink_fence",
    "street_lamp_01",
    "industrial_wall_lamp",
    "industrial_pastic_container",
]
HDRIS = ["cobblestone_street_night"]
RES = "1k"


def get_json(url):
    req = urllib.request.Request(url, headers={"User-Agent": "curl/8.5.0"})
    with urllib.request.urlopen(req, timeout=60) as r:
        return json.load(r)


def fetch(url, dest):
    os.makedirs(os.path.dirname(dest), exist_ok=True)
    if os.path.exists(dest) and os.path.getsize(dest) > 0:
        return os.path.getsize(dest)
    req = urllib.request.Request(url, headers={"User-Agent": "cyber-shoot-proto"})
    with urllib.request.urlopen(req, timeout=180) as r, open(dest, "wb") as f:
        while True:
            chunk = r.read(1 << 16)
            if not chunk:
                break
            f.write(chunk)
    return os.path.getsize(dest)


total = 0
for m in MODELS:
    try:
        info = get_json("https://api.polyhaven.com/files/" + m)
        g = info["gltf"][RES]["gltf"]
    except Exception as e:
        print("SALTO", m, e, flush=True)
        continue
    url = g["url"]
    d = os.path.join(BASE_PROPS, m)
    name = url.rsplit("/", 1)[-1]
    total += fetch(url, os.path.join(d, name))
    inc = dict(g.get("include") or {})
    inc[name] = {"url": url}
    for rel, meta in inc.items():
        try:
            total += fetch(meta["url"], os.path.join(d, rel))
        except Exception as e:
            print("  FALLO", m, rel, e, flush=True)
    # comprobar que el gltf tiene todos sus ficheros en local
    gltf = json.load(open(os.path.join(d, name)))
    for b in gltf.get("buffers", []) + gltf.get("images", []):
        u = b.get("uri")
        if u and not u.startswith("data:") and not os.path.exists(os.path.join(d, u)):
            print("  FALTA", m, u, flush=True)
    print(m, "ok", round(total / 1e6, 1), "MB acumulado", flush=True)

for h in HDRIS:
    info = get_json("https://api.polyhaven.com/files/" + h)
    url = info["hdri"][RES]["hdr"]["url"]
    p = os.path.join(BASE_HDRI, h + "_" + RES + ".hdr")
    total += fetch(url, p)
    print(h, "ok", round(total / 1e6, 1), "MB acumulado", flush=True)

print("TOTAL", round(total / 1e6, 1), "MB")
