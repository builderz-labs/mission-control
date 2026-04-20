"""One-time Google OAuth setup script.

Run this LOCALLY on your machine (not on VPS). It will:
1. Open a browser for you to log in with roce.hickey@gmail.com
2. Approve Calendar + Gmail + Drive access
3. Save token.json that the VPS execution engine will use

Usage:
    pip install google-auth-oauthlib google-api-python-client
    python scripts/google_oauth_setup.py

After running, copy the generated token.json to VPS:
    scp google_token.json root@187.127.96.74:/docker/roce-os/data/google_token.json
"""
import json
import os

from google_auth_oauthlib.flow import InstalledAppFlow

# All scopes we need — one auth covers Calendar, Gmail, and Drive
SCOPES = [
    "https://www.googleapis.com/auth/calendar",
    "https://www.googleapis.com/auth/gmail.modify",
    "https://www.googleapis.com/auth/gmail.send",
    "https://www.googleapis.com/auth/drive",
    "https://www.googleapis.com/auth/documents",
]

# You need a client_secrets.json from Google Cloud Console.
# Steps to create one:
# 1. Go to https://console.cloud.google.com/
# 2. Create a project (or use existing)
# 3. Enable Calendar API, Gmail API, Drive API
# 4. Go to Credentials → Create Credentials → OAuth 2.0 Client ID
# 5. Application type: "Desktop app"
# 6. Download the JSON and save as client_secrets.json in this directory
CLIENT_SECRETS_FILE = os.path.join(os.path.dirname(__file__), "client_secrets.json")
TOKEN_FILE = os.path.join(os.path.dirname(__file__), "google_token.json")


def main():
    if not os.path.exists(CLIENT_SECRETS_FILE):
        print("ERROR: client_secrets.json not found!")
        print()
        print("You need to create an OAuth client in Google Cloud Console:")
        print("1. Go to https://console.cloud.google.com/apis/credentials")
        print("2. Create project (or select existing)")
        print("3. Enable these APIs:")
        print("   - Google Calendar API")
        print("   - Gmail API")
        print("   - Google Drive API")
        print("4. Create OAuth 2.0 Client ID (type: Desktop app)")
        print("5. Download the JSON file")
        print(f"6. Save it as: {CLIENT_SECRETS_FILE}")
        print()
        print("Then run this script again.")
        return

    flow = InstalledAppFlow.from_client_secrets_file(CLIENT_SECRETS_FILE, SCOPES)
    creds = flow.run_local_server(port=8080)

    # Save the token
    token_data = {
        "token": creds.token,
        "refresh_token": creds.refresh_token,
        "token_uri": creds.token_uri,
        "client_id": creds.client_id,
        "client_secret": creds.client_secret,
        "scopes": creds.scopes,
    }

    with open(TOKEN_FILE, "w") as f:
        json.dump(token_data, f, indent=2)

    print(f"\nSuccess! Token saved to: {TOKEN_FILE}")
    print(f"\nNow copy it to VPS:")
    print(f"  scp {TOKEN_FILE} root@187.127.96.74:/docker/roce-os/data/google_token.json")
    print(f"\nScopes authorized: {', '.join(SCOPES)}")


if __name__ == "__main__":
    main()
