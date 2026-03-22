/**
 * Focused apiClient tests (session token path; getTokenFromSession uses axios.get, not client.get).
 */

jest.mock('axios', () => {
  const sharedGet = jest.fn();
  const sharedPost = jest.fn();
  const mockClient = {
    get: sharedGet,
    post: sharedPost,
    put: jest.fn(),
    delete: jest.fn(),
    patch: jest.fn(),
    interceptors: {
      request: { use: jest.fn(), eject: jest.fn() },
      response: { use: jest.fn(), eject: jest.fn() },
    },
    defaults: { headers: { common: {} } },
  };
  return {
    __esModule: true,
    default: {
      create: jest.fn(() => mockClient),
      get: sharedGet,
      post: sharedPost,
      defaults: { headers: { common: {} } },
    },
  };
});

import axios from 'axios';
import apiClient from '../apiClient';

const mockClient = axios.create.mock.results[0].value;
const sharedGet = mockClient.get;
const sharedPost = mockClient.post;

const requestInterceptorFn =
  mockClient.interceptors.request.use.mock.calls[0] &&
  mockClient.interceptors.request.use.mock.calls[0][0];

describe('apiClient session OAuth', () => {
  beforeEach(() => {
    sharedGet.mockReset();
    sharedPost.mockReset();
    mockClient.defaults.headers.common = {};
  });

  it('getTokenFromSession returns accessToken from user status', async () => {
    sharedGet.mockResolvedValueOnce({
      data: {
        authenticated: true,
        accessToken: 'oauth-access-token-123',
        tokenType: 'Bearer',
        expiresAt: Date.now() + 3600000,
        user: { id: 'u1', username: 'u', email: 'u@test.com' },
      },
    });

    const token = await apiClient.getTokenFromSession();

    expect(token).toBe('oauth-access-token-123');
    expect(sharedGet).toHaveBeenCalledWith('/api/auth/oauth/user/status');
  });

  it('getTokenFromSession falls back to admin status when user is not authenticated', async () => {
    sharedGet
      .mockResolvedValueOnce({
        data: { authenticated: false },
      })
      .mockResolvedValueOnce({
        data: {
          authenticated: true,
          accessToken: 'admin-token',
          tokenType: 'Bearer',
          expiresAt: Date.now() + 3600000,
          user: { id: 'a1', username: 'admin', role: 'admin' },
        },
      });

    const token = await apiClient.getTokenFromSession();

    expect(token).toBe('admin-token');
    expect(sharedGet).toHaveBeenCalledWith('/api/auth/oauth/user/status');
    expect(sharedGet).toHaveBeenCalledWith('/api/auth/oauth/status');
  });

  it('request interceptor adds Bearer when getValidToken resolves', async () => {
    expect(requestInterceptorFn).toEqual(expect.any(Function));
    sharedGet.mockResolvedValue({
      data: { authenticated: true, accessToken: 'tok', tokenType: 'Bearer' },
    });

    jest.spyOn(apiClient, 'getValidToken').mockResolvedValue('tok');

    const out = await requestInterceptorFn({ headers: {} });
    expect(out.headers.Authorization).toBe('Bearer tok');
  });
});
