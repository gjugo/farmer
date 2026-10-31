"""Seasonal versions, registered after the rest of the pack so the manifest only grows at its end.

- ground tiles (grass, paths, soil, locked land) in four seasons: tiles.build_seasons
- scenery (trees, bushes, rocks, pond) in four seasons: props.build_seasons
- every building in winter, with snow on the roof: snow.build_winter (derived from the sprites themselves)
"""
import tiles, props, snow


def build():
    tiles.build_seasons()
    props.build_seasons()
    snow.build_winter()   # last: it reads every building registered so far
