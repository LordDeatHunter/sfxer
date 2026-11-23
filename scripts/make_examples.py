"""Regenerate examples/: one patch per recipe (and per kind), using the built CLI.
Only writes .json files inside examples/. Run from anywhere: python scripts/make_examples.py"""
import pathlib
import subprocess

root = pathlib.Path(__file__).resolve().parent.parent
cli = root / "packages" / "cli" / "dist" / "main.js"
out = root / "examples"
out.mkdir(exist_ok=True)

EXAMPLES = {
    "impact_wood": ["impact"],
    "impact_metal_rattle": ["impact", "-p", "material=metal", "-p", "rattle=0.5"],
    "impact_glass_small": ["impact", "-p", "material=glass", "-p", "size=0.2", "-p", "weight=0"],
    "whoosh": ["whoosh"],
    "explosion": ["explosion"],
    "footstep_concrete": ["footstep"],
    "footstep_gravel": ["footstep", "-p", "surface=gravel"],
    "ui_click": ["ui", "-p", "kind=click"],
    "ui_confirm": ["ui", "-p", "kind=confirm"],
    "ui_error": ["ui", "-p", "kind=error"],
    "pickup_coin": ["pickup", "-p", "kind=coin"],
    "pickup_powerup": ["pickup", "-p", "kind=powerup"],
    "magic_cast": ["magic", "-p", "kind=cast"],
    "magic_charge": ["magic", "-p", "kind=charge"],
    "energy_laser": ["energy", "-p", "kind=laser"],
    "energy_zap": ["energy", "-p", "kind=zap"],
    "mechanical_latch": ["mechanical", "-p", "kind=latch"],
    "mechanical_servo": ["mechanical", "-p", "kind=servo"],
    "door_knock": ["door", "-p", "kind=knock"],
    "door_creak": ["door", "-p", "kind=creak"],
    "ambience_rain": ["ambience_loop", "-p", "kind=rain"],
    "ambience_fire": ["ambience_loop", "-p", "kind=fire"],
    "gore_squish": ["gore", "-p", "kind=squish"],
    "gore_splat": ["gore", "-p", "kind=splat"],
    "gore_squelch": ["gore", "-p", "kind=squelch"],
    "gore_slime": ["gore", "-p", "kind=slime", "-p", "viscosity=0.8"],
    "gore_stab": ["gore", "-p", "kind=stab"],
    "gore_crunch": ["gore", "-p", "kind=crunch"],
    "gore_gib": ["gore", "-p", "kind=gib"],
    "gore_drip": ["gore", "-p", "kind=drip"],
}

failed = 0
for name, args in EXAMPLES.items():
    r = subprocess.run(["bun", str(cli), "recipe", *args, "-o", str(out / f"{name}.json")], capture_output=True, text=True)
    if r.returncode != 0:
        failed += 1
        print("FAILED", name, r.stderr.strip())
print(f"wrote {len(EXAMPLES) - failed} example patches to {out}")
