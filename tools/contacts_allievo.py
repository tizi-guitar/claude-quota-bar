#!/usr/bin/env python3
"""Sostituisce "Allievo" con "[A]" nel nome dei contatti Google.

Modifica SOLO i campi del nome (nome, secondo nome, cognome, prefisso, suffisso).
Tutti gli altri dati del contatto (telefoni, email, indirizzi, note, foto...) non
vengono toccati: l'aggiornamento usa updatePersonFields=names.

Uso:
    python3 contacts_allievo.py            # anteprima (dry-run), non modifica nulla
    python3 contacts_allievo.py --apply    # applica le modifiche

Requisiti:
    pip install google-api-python-client google-auth-oauthlib
    credentials.json: client OAuth "App desktop" creato in Google Cloud Console
    (API abilitata: People API). Al primo avvio si apre il browser per il consenso;
    il token viene salvato in token.json.
"""
import argparse
import json
import re
import sys
import time
from datetime import datetime
from pathlib import Path

from google.auth.transport.requests import Request
from google.oauth2.credentials import Credentials
from google_auth_oauthlib.flow import InstalledAppFlow
from googleapiclient.discovery import build

SCOPES = ["https://www.googleapis.com/auth/contacts"]
PATTERN = re.compile(r"\bAllievo\b", re.IGNORECASE)
REPLACEMENT = "[A]"
NAME_FIELDS = ("givenName", "middleName", "familyName",
               "honorificPrefix", "honorificSuffix")


def get_service(credentials_file, token_file):
    creds = None
    if Path(token_file).exists():
        creds = Credentials.from_authorized_user_file(token_file, SCOPES)
    if not creds or not creds.valid:
        if creds and creds.expired and creds.refresh_token:
            creds.refresh(Request())
        else:
            flow = InstalledAppFlow.from_client_secrets_file(credentials_file, SCOPES)
            creds = flow.run_local_server(port=0)
        Path(token_file).write_text(creds.to_json())
    return build("people", "v1", credentials=creds)


def all_contacts(service):
    token = None
    while True:
        resp = service.people().connections().list(
            resourceName="people/me",
            pageSize=1000,
            pageToken=token,
            personFields="names,metadata",
            sources=["READ_SOURCE_TYPE_CONTACT"],
        ).execute()
        yield from resp.get("connections", [])
        token = resp.get("nextPageToken")
        if not token:
            break


def fix_names(person):
    """Restituisce la nuova lista 'names' se qualcosa cambia, altrimenti None."""
    names = person.get("names", [])
    changed = False
    new_names = []
    for n in names:
        # copia solo i campi modificabili (displayName & co. sono di sola lettura)
        entry = {k: n[k] for k in NAME_FIELDS if k in n}
        for k in NAME_FIELDS:
            if k in entry and PATTERN.search(entry[k]):
                entry[k] = PATTERN.sub(REPLACEMENT, entry[k])
                changed = True
        if "metadata" in n:
            entry["metadata"] = n["metadata"]
        new_names.append(entry)
    return new_names if changed else None


def display(person):
    names = person.get("names", [])
    return names[0].get("displayName", "?") if names else "?"


def main():
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--apply", action="store_true",
                    help="applica davvero le modifiche (default: solo anteprima)")
    ap.add_argument("--credentials", default="credentials.json")
    ap.add_argument("--token", default="token.json")
    args = ap.parse_args()

    service = get_service(args.credentials, args.token)

    todo = []
    total = 0
    for person in all_contacts(service):
        total += 1
        new_names = fix_names(person)
        if new_names:
            todo.append((person, new_names))

    print(f"Contatti letti: {total} - da modificare: {len(todo)}\n")
    for person, new_names in todo:
        print(f"  {display(person)!r}  ->  "
              f"{' '.join(filter(None, (new_names[0].get(k) for k in ('honorificPrefix', 'givenName', 'middleName', 'familyName', 'honorificSuffix'))))!r}")

    if not todo:
        return
    if not args.apply:
        print("\nAnteprima soltanto. Rilancia con --apply per modificare.")
        return

    # backup dei nomi originali prima di scrivere
    backup = Path(f"backup_contatti_{datetime.now():%Y%m%d_%H%M%S}.json")
    backup.write_text(json.dumps(
        [{"resourceName": p["resourceName"], "names": p.get("names", [])} for p, _ in todo],
        ensure_ascii=False, indent=2))
    print(f"\nBackup salvato in {backup}")

    ok = 0
    for person, new_names in todo:
        body = {"etag": person["etag"], "names": new_names}
        try:
            service.people().updateContact(
                resourceName=person["resourceName"],
                updatePersonFields="names",
                body=body,
            ).execute()
            ok += 1
        except Exception as e:  # noqa: BLE001
            print(f"ERRORE su {display(person)!r}: {e}", file=sys.stderr)
        time.sleep(0.7)  # limite API: ~90 scritture al minuto
    print(f"Aggiornati {ok}/{len(todo)} contatti.")


if __name__ == "__main__":
    main()
