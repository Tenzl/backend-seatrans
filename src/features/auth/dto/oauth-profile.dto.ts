export interface OAuthUserProfile {
  email: string;
  fullName: string;
  provider: string;
  providerId: string;
  emailVerified: boolean;
}

export function resolveGoogleFullName(userInfo: {
  name?: string;
  given_name?: string;
  family_name?: string;
}): string {
  const displayName = userInfo.name?.trim();
  if (displayName) return displayName;

  const parts = [userInfo.given_name, userInfo.family_name]
    .map((part) => part?.trim())
    .filter(Boolean);

  return parts.join(' ');
}
