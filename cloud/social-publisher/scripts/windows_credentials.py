"""Social Publisher admin credential in the current Windows user's vault."""
import ctypes
from ctypes import wintypes

ADMIN_CREDENTIAL_TARGET = 'stellark-social-publisher-admin'
CREDENTIAL_GENERIC = 1
CREDENTIAL_PERSIST_LOCAL_MACHINE = 2
CREDENTIAL_FLAGS = 0
CREDENTIAL_NOT_FOUND = 1168
CREDENTIAL_MAXIMUM_BYTES = 2560
TOKEN_ENCODING = 'utf-8'
CREDENTIAL_USERNAME = 'social-publisher'


class Credential(ctypes.Structure):
    _fields_ = [
        ('Flags', wintypes.DWORD),
        ('Type', wintypes.DWORD),
        ('TargetName', wintypes.LPWSTR),
        ('Comment', wintypes.LPWSTR),
        ('LastWritten', wintypes.FILETIME),
        ('CredentialBlobSize', wintypes.DWORD),
        ('CredentialBlob', ctypes.POINTER(wintypes.BYTE)),
        ('Persist', wintypes.DWORD),
        ('AttributeCount', wintypes.DWORD),
        ('Attributes', wintypes.LPVOID),
        ('TargetAlias', wintypes.LPWSTR),
        ('UserName', wintypes.LPWSTR),
    ]


ADVAPI = ctypes.WinDLL('Advapi32.dll', use_last_error=True)
ADVAPI.CredReadW.argtypes = [wintypes.LPCWSTR, wintypes.DWORD, wintypes.DWORD,
                             ctypes.POINTER(ctypes.POINTER(Credential))]
ADVAPI.CredReadW.restype = wintypes.BOOL
ADVAPI.CredWriteW.argtypes = [ctypes.POINTER(Credential), wintypes.DWORD]
ADVAPI.CredWriteW.restype = wintypes.BOOL
ADVAPI.CredFree.argtypes = [wintypes.LPVOID]
ADVAPI.CredFree.restype = None


def read_admin_token():
    credential = ctypes.POINTER(Credential)()
    if not ADVAPI.CredReadW(ADMIN_CREDENTIAL_TARGET, CREDENTIAL_GENERIC,
                           CREDENTIAL_FLAGS, ctypes.byref(credential)):
        error = ctypes.get_last_error()
        if error == CREDENTIAL_NOT_FOUND:
            return None
        raise ctypes.WinError(error)
    try:
        value = credential.contents
        return ctypes.string_at(value.CredentialBlob, value.CredentialBlobSize).decode(TOKEN_ENCODING)
    finally:
        ADVAPI.CredFree(credential)


def write_admin_token(token):
    encoded = token.encode(TOKEN_ENCODING)
    if not encoded or len(encoded) > CREDENTIAL_MAXIMUM_BYTES:
        raise ValueError('Admin credential must fit the Windows generic credential contract')
    buffer = (wintypes.BYTE * len(encoded)).from_buffer_copy(encoded)
    credential = Credential()
    credential.Type = CREDENTIAL_GENERIC
    credential.TargetName = ADMIN_CREDENTIAL_TARGET
    credential.CredentialBlobSize = len(encoded)
    credential.CredentialBlob = buffer
    credential.Persist = CREDENTIAL_PERSIST_LOCAL_MACHINE
    credential.UserName = CREDENTIAL_USERNAME
    if not ADVAPI.CredWriteW(ctypes.byref(credential), CREDENTIAL_FLAGS):
        raise ctypes.WinError(ctypes.get_last_error())
