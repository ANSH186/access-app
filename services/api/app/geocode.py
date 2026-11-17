"""Reverse geocoding and plain-language place context for blind users.

Photon (OpenStreetMap-based) is the primary service: it is free, needs no key,
and already knows the NIE North Campus building. Nominatim and BigDataCloud are
fallbacks so a single provider outage does not leave the user without a place
name.
"""
from __future__ import annotations

import asyncio
import math
import time
from dataclasses import dataclass
from typing import Any

import httpx

PHOTON_URL = "https://photon.komoot.io/reverse"
NOMINATIM_URL = "https://nominatim.openstreetmap.org/reverse"
BIGDATA_URL = "https://api.bigdatacloud.net/data/reverse-geocode-client"
USER_AGENT = "AccessAbleAI/2.0 (+https://github.com/ANSH186/access-app)"
_CACHE: dict[tuple[float, float], tuple[float, PlaceContext]] = {}
_CACHE_TTL_S = 24 * 60 * 60


@dataclass
class PlaceContext:
    lat: float
    lng: float
    display_name: str | None = None
    name: str | None = None
    road: str | None = None
    suburb: str | None = None
    city: str | None = None
    state: str | None = None
    country: str | None = None
    postcode: str | None = None
    error: str | None = None

    @property
    def short(self) -> str:
        parts = [self.name or self.road, self.city, self.state, self.suburb]
        seen: list[str] = []
        for p in parts:
            if p and p not in seen:
                seen.append(p)
        return ", ".join(seen[:3]) if seen else (self.display_name or "an unknown place")

    def prompt_line(self) -> str:
        bits = [
            f"latitude {self.lat:.5f}, longitude {self.lng:.5f}",
            f"address: {self.display_name}" if self.display_name else None,
            f"place name: {self.name}" if self.name else None,
            f"road: {self.road}" if self.road else None,
            f"area: {self.suburb}" if self.suburb else None,
            f"city: {self.city}" if self.city else None,
            f"state: {self.state}" if self.state else None,
        ]
        return "; ".join(b for b in bits if b)


def _round(lat: float, lng: float) -> tuple[float, float]:
    # ~11 m grid: enough for reverse geocoding, avoids a request for every GPS update.
    return (round(lat, 4), round(lng, 4))


async def _photon(lat: float, lng: float, client: httpx.AsyncClient) -> dict[str, Any] | None:
    try:
        r = await client.get(
            PHOTON_URL,
            params={"lat": lat, "lon": lng, "limit": 1},
            headers={"User-Agent": USER_AGENT, "Accept": "application/json"},
        )
        if r.status_code != 200:
            return None
        data = r.json()
        features = data.get("features") or []
        if not features:
            return None
        props = features[0].get("properties") or {}
        name = props.get("name")
        street = props.get("street")
        city = props.get("city") or props.get("district")
        county = props.get("county")
        state = props.get("state")
        country = props.get("country")
        postcode = props.get("postcode")
        parts = [name or street, city, county, state, country]
        display = ", ".join(str(p) for p in parts if p)
        return {
            "display_name": display or name,
            "name": name,
            "road": street,
            "suburb": county,
            "city": city,
            "state": state,
            "country": country,
            "postcode": postcode,
        }
    except (httpx.HTTPError, ValueError):
        return None


async def _nominatim(lat: float, lng: float, client: httpx.AsyncClient) -> dict[str, Any] | None:
    try:
        r = await client.get(
            NOMINATIM_URL,
            params={"lat": lat, "lon": lng, "format": "jsonv2", "zoom": 18, "addressdetails": 1},
            headers={"User-Agent": USER_AGENT, "Accept": "application/json"},
        )
        if r.status_code != 200:
            return None
        raw = r.json() or {}
        if not raw:
            return None
        address = raw.get("address") or {}
        return {
            "display_name": raw.get("display_name"),
            "name": raw.get("name") or address.get("amenity") or address.get("building") or address.get("shop"),
            "road": address.get("road") or address.get("pedestrian") or address.get("footway"),
            "suburb": address.get("suburb") or address.get("neighbourhood") or address.get("village"),
            "city": address.get("city") or address.get("town") or address.get("municipality"),
            "state": address.get("state"),
            "country": address.get("country"),
            "postcode": address.get("postcode"),
        }
    except (httpx.HTTPError, ValueError):
        return None


async def _bigdata(lat: float, lng: float, client: httpx.AsyncClient) -> dict[str, Any] | None:
    try:
        r = await client.get(
            BIGDATA_URL,
            params={"latitude": lat, "longitude": lng, "localityLanguage": "en"},
            headers={"User-Agent": USER_AGENT, "Accept": "application/json"},
        )
        if r.status_code != 200:
            return None
        raw = r.json() or {}
        city = raw.get("city") or raw.get("locality")
        state = raw.get("principalSubdivision")
        country = raw.get("countryName")
        parts = [raw.get("locality"), city, state, country]
        display = ", ".join(str(p) for p in parts if p and p != "null")
        return {
            "display_name": display or None,
            "name": raw.get("locality"),
            "road": None,
            "suburb": raw.get("locality"),
            "city": city,
            "state": state,
            "country": country,
            "postcode": raw.get("postcode") or None,
        }
    except (httpx.HTTPError, ValueError):
        return None


async def reverse_geocode(lat: float, lng: float, timeout_s: float = 10.0) -> PlaceContext:
    key = _round(lat, lng)
    hit = _CACHE.get(key)
    now = time.monotonic()
    if hit and now - hit[0] < _CACHE_TTL_S:
        return hit[1]

    raw: dict[str, Any] | None = None
    try:
        async with httpx.AsyncClient(timeout=timeout_s) as client:
            raw = await _photon(lat, lng, client)
            if raw is None:
                raw = await _nominatim(lat, lng, client)
            if raw is None:
                raw = await _bigdata(lat, lng, client)
    except httpx.HTTPError:
        raw = None

    ctx = PlaceContext(
        lat=lat,
        lng=lng,
        display_name=(raw or {}).get("display_name"),
        name=(raw or {}).get("name"),
        road=(raw or {}).get("road"),
        suburb=(raw or {}).get("suburb"),
        city=(raw or {}).get("city"),
        state=(raw or {}).get("state"),
        country=(raw or {}).get("country"),
        postcode=(raw or {}).get("postcode"),
    )
    if not raw:
        ctx.error = "address_unavailable"
    _CACHE[key] = (now, ctx)
    return ctx


async def reverse_many(points: list[tuple[float, float]]) -> list[PlaceContext]:
    return list(await asyncio.gather(*(reverse_geocode(lat, lng) for lat, lng in points)))


def bearing_text(from_lat: float, from_lng: float, to_lat: float, to_lng: float) -> str:
    d_lng = math.radians(to_lng - from_lng)
    y = math.sin(d_lng) * math.cos(math.radians(to_lat))
    x = math.cos(math.radians(from_lat)) * math.sin(math.radians(to_lat)) - math.sin(
        math.radians(from_lat)
    ) * math.cos(math.radians(to_lat)) * math.cos(d_lng)
    deg = (math.degrees(math.atan2(y, x)) + 360) % 360
    dirs = ["north", "north-east", "east", "south-east", "south", "south-west", "west", "north-west"]
    return dirs[int((deg + 22.5) // 45) % 8]
