"""CoStar data: who's inside (tenants, occupancy, age, vacancy).

There's no public CoStar API. Get data from the CoStar sponsor table (API, export, or
their portal), then save it per building as fixtures/<building_id>/costar.json using
the shape in fixtures/sample/costar.json. If they give you an API, add a fetch()
here that writes the same shape.
"""
from .cache import FIXTURES, load_json


def get(building_id: str) -> dict:
    data = load_json(building_id, "costar.json")
    if data is None:
        raise FileNotFoundError(
            f"No CoStar data for {building_id}. Save it to {FIXTURES / building_id / 'costar.json'} "
            "(shape: fixtures/sample/costar.json)."
        )
    return data
