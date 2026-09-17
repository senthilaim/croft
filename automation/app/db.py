from pymongo import MongoClient
from pymongo.database import Database

from .settings import settings

_client: MongoClient = MongoClient(settings.mongodb_uri)


def get_db() -> Database:
    return _client.get_default_database()
