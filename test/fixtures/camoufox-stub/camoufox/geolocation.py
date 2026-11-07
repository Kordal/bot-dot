# Stand-in for camoufox.geolocation: every address is placed, and needs_update would download a new database.
def needs_update(config=None):
    raise PermissionError("the database folder is root's")


def geoip_allowed():
    pass


def get_geolocation(ip, geoip_db=None):
    needs_update()
    return {"ip": ip}
