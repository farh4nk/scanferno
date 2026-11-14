"""On-demand ready buildings: catalog search hit → same cache + floor plan as the heroes.

    prepare(key)              fetch vector, register, build floorplan
    status(key)               ready / scanned without fetching
    resolve.from_text(...)    address → catalog entry
    resolve.prepare_for_address(...)
    registry                  fixtures/ondemand/ready.json
"""
from .ready import OnboardError, prepare, status
from . import registry, resolve

__all__ = ["OnboardError", "prepare", "status", "registry", "resolve"]
