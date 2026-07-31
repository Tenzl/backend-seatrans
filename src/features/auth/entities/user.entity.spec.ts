import { User } from './user.entity';

describe('User identity normalization', () => {
  it('normalizes canonical and OAuth identity fields together', () => {
    const user = Object.assign(new User(), {
      email: '  Admin@Example.Test ',
      username: '  Admin_User ',
      oauthProvider: ' GOOGLE ',
      oauthProviderId: ' subject-1 ',
    });

    user.normalizeIdentityFields();

    expect(user).toMatchObject({
      email: 'admin@example.test',
      username: 'admin_user',
      oauthProvider: 'google',
      oauthProviderId: 'subject-1',
    });
  });

  it('stores blank or partial OAuth pairs as no OAuth identity', () => {
    const user = Object.assign(new User(), {
      email: 'user@example.test',
      username: null,
      oauthProvider: '',
      oauthProviderId: '',
    });

    user.normalizeIdentityFields();

    expect(user.oauthProvider).toBeNull();
    expect(user.oauthProviderId).toBeNull();
  });
});
