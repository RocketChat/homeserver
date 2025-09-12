/**
 * Unit tests for MediaService
 * Testing library/framework: Jest with ts-jest (TypeScript)
 *
 * These tests focus on the MediaService behavior:
 * - Authenticated download first, with detailed fallbacks
 * - Legacy v3/r0 fallbacks and logging paths
 * - Multipart parsing, boundary handling, trimming
 * - Low-level httpsRequest success/error paths
 */

import { MediaService } from './media.service';
import * as https from 'node:https';
import { EventEmitter } from 'events';

// Mock the logger factory used by the service so we can assert logs.
const logger = {
  info: jest.fn(),
  debug: jest.fn(),
  error: jest.fn(),
};
jest.mock('@hs/core', () => ({
  createLogger: jest.fn(() => logger),
}));

// Helpers
const zeroHeaders: Record<string, string | string[]> = {};
const asAny = <T>(v: unknown) => v as T;

describe('MediaService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.restoreAllMocks();
  });

  const makeService = (prepareSignedRequestImpl?: any) => {
    const federationRequest = {
      prepareSignedRequest:
        prepareSignedRequestImpl ??
        jest.fn().mockResolvedValue({
          url: new URL('https://remote.example/_matrix/federation/v1/media/download/mX'),
          headers: { Authorization: 'sig' },
        }),
    };
    return { svc: new MediaService(asAny(federationRequest)), federationRequest };
  };

  describe('downloadFromRemoteServer (happy path and fallbacks)', () => {
    it('downloads via authenticated endpoint when it returns 2xx and logs info', async () => {
      const { svc, federationRequest } = makeService(
        jest.fn().mockResolvedValue({
          url: new URL('https://remote.example/_matrix/federation/v1/media/download/m1'),
          headers: { Authorization: 'sig' },
        }),
      );

      const httpsSpy = jest.spyOn(asAny(svc), 'httpsRequest').mockResolvedValue({
        statusCode: 200,
        headers: { 'content-type': 'image/png' },
        body: Buffer.from('AUTH_DATA'),
      });

      const data = await svc.downloadFromRemoteServer('remote.example', 'm1');

      expect(data).toEqual(Buffer.from('AUTH_DATA'));
      expect(federationRequest.prepareSignedRequest).toHaveBeenCalledWith(
        'remote.example',
        '/_matrix/federation/v1/media/download/m1',
        'GET',
      );
      expect(logger.info).toHaveBeenCalledWith(
        'Downloaded media m1 from remote.example via authenticated endpoint',
      );
      expect(httpsSpy).toHaveBeenCalledTimes(1);
    });

    it('falls back to legacy endpoints when authenticated is non-2xx; succeeds on r0 and logs info', async () => {
      const { svc } = makeService(
        jest.fn().mockResolvedValue({
          url: new URL('https://remote.example/_matrix/federation/v1/media/download/m2'),
          headers: {},
        }),
      );

      const httpsSpy = jest
        .spyOn(asAny(svc), 'httpsRequest')
        // Auth attempt -> non-2xx
        .mockResolvedValueOnce({
          statusCode: 401,
          headers: zeroHeaders,
          body: Buffer.alloc(0),
        })
        // Legacy v3 -> 404
        .mockResolvedValueOnce({
          statusCode: 404,
          headers: zeroHeaders,
          body: Buffer.alloc(0),
        })
        // Legacy r0 -> 200
        .mockResolvedValueOnce({
          statusCode: 200,
          headers: { 'content-type': 'image/jpeg' },
          body: Buffer.from('LEGACY_OK'),
        });

      const data = await svc.downloadFromRemoteServer('s.example', 'm2');
      expect(data).toEqual(Buffer.from('LEGACY_OK'));
      expect(logger.info).toHaveBeenCalledWith(
        'Downloaded media m2 from s.example via legacy endpoint',
      );
      expect(httpsSpy).toHaveBeenCalledTimes(3);
    });

    it('logs debug when authenticated path throws; then throws if all attempts fail', async () => {
      const { svc } = makeService(
        jest.fn().mockResolvedValue({
          url: new URL('https://s.example/_matrix/federation/v1/media/download/m3'),
          headers: {},
        }),
      );

      const httpsSpy = jest
        .spyOn(asAny(svc), 'httpsRequest')
        // Auth attempt throws -> triggers "Authenticated download failed" debug log
        .mockRejectedValueOnce(new Error('auth failure'))
        // Legacy v3 -> 500
        .mockResolvedValueOnce({
          statusCode: 500,
          headers: zeroHeaders,
          body: Buffer.alloc(0),
        })
        // Legacy r0 -> 502
        .mockResolvedValueOnce({
          statusCode: 502,
          headers: zeroHeaders,
          body: Buffer.alloc(0),
        });

      await expect(svc.downloadFromRemoteServer('s.example', 'm3')).rejects.toThrow(
        'Failed to download media m3 from s.example',
      );

      expect(logger.debug).toHaveBeenCalledWith(
        expect.stringContaining('Authenticated download failed:'),
      );
      expect(httpsSpy).toHaveBeenCalledTimes(3);
    });

    it('logs debug when a legacy endpoint request throws and continues to next', async () => {
      const { svc } = makeService(
        jest.fn().mockResolvedValue({
          url: new URL('https://s.example/_matrix/federation/v1/media/download/m4'),
          headers: {},
        }),
      );

      const httpsSpy = jest
        .spyOn(asAny(svc), 'httpsRequest')
        // Auth returns non-2xx -> triggers fallback without debug log in auth
        .mockResolvedValueOnce({
          statusCode: 404,
          headers: zeroHeaders,
          body: Buffer.alloc(0),
        })
        // Legacy v3 throws -> should log "Legacy endpoint failed"
        .mockRejectedValueOnce(new Error('v3 hard fail'))
        // Legacy r0 non-2xx -> end of attempts -> throws overall
        .mockResolvedValueOnce({
          statusCode: 400,
          headers: zeroHeaders,
          body: Buffer.alloc(0),
        });

      await expect(svc.downloadFromRemoteServer('s.example', 'm4')).rejects.toThrow(
        'Failed to download media m4 from s.example',
      );
      expect(logger.debug).toHaveBeenCalledWith(
        expect.stringContaining('Legacy endpoint failed:'),
      );
      expect(httpsSpy).toHaveBeenCalledTimes(3);
    });
  });

  describe('extractMediaFromResponse (multipart and non-multipart)', () => {
    it('returns body directly when content-type is not multipart', () => {
      const { svc } = makeService();
      const response = {
        statusCode: 200,
        headers: { 'content-type': 'image/svg+xml' as const },
        body: Buffer.from('BODY'),
      };
      const out = asAny(svc).extractMediaFromResponse(response);
      expect(out).toEqual(Buffer.from('BODY'));
    });

    it('accepts content-type header as array form and returns body', () => {
      const { svc } = makeService();
      const response = {
        statusCode: 200,
        headers: { 'content-type': ['image/jpeg'] as const },
        body: Buffer.from('IMG'),
      };
      const out = asAny(svc).extractMediaFromResponse(response);
      expect(out).toEqual(Buffer.from('IMG'));
    });

    it('throws when multipart content-type lacks boundary', () => {
      const { svc } = makeService();
      const response = {
        statusCode: 200,
        headers: { 'content-type': 'multipart/mixed' as const },
        body: Buffer.from(''),
      };
      expect(() => asAny(svc).extractMediaFromResponse(response)).toThrow(
        'No boundary in multipart response',
      );
    });

    it('extracts first non-JSON part and trims trailing CRLF', () => {
      const { svc } = makeService();
      const boundary = 'abc123';
      const CRLF = '\r\n';

      const partJsonHeaders = 'Content-Type: application/json';
      const partImgHeaders = 'Content-Type: image/png';

      const parts: Buffer[] = [];
      // --boundary + JSON part
      parts.push(Buffer.from(`--${boundary}${CRLF}${partJsonHeaders}${CRLF}${CRLF}`));
      parts.push(Buffer.from('{"ok":true}'));
      parts.push(Buffer.from(CRLF));
      // --boundary + image part (with trailing CRLFs to be trimmed)
      parts.push(Buffer.from(`--${boundary}${CRLF}${partImgHeaders}${CRLF}${CRLF}`));
      parts.push(Buffer.from('IMAGE_BYTES'));
      parts.push(Buffer.from('\r\n\r\n'));
      // closing delimiter (not strictly required by the parser, but realistic)
      parts.push(Buffer.from(`--${boundary}${CRLF}`));

      const body = Buffer.concat(parts);
      const response = {
        statusCode: 200,
        headers: { 'content-type': `multipart/mixed; boundary=${boundary}` },
        body,
      };

      const out = asAny(svc).extractMediaFromResponse(response);
      expect(out).toEqual(Buffer.from('IMAGE_BYTES'));
    });

    it('throws when multipart contains no non-JSON media part', () => {
      const { svc } = makeService();
      const boundary = 'no-media';
      const CRLF = '\r\n';

      const parts: Buffer[] = [];
      parts.push(
        Buffer.from(`--${boundary}${CRLF}Content-Type: application/json${CRLF}${CRLF}`),
      );
      parts.push(Buffer.from('{"only":"json"}'));
      parts.push(Buffer.from(CRLF));
      parts.push(Buffer.from(`--${boundary}${CRLF}`));

      const response = {
        statusCode: 200,
        headers: { 'content-type': `multipart/form-data; boundary=${boundary}` },
        body: Buffer.concat(parts),
      };

      expect(() => asAny(svc).extractMediaFromResponse(response)).toThrow(
        'No media content in multipart response',
      );
    });
  });

  describe('httpsRequest (low-level behavior)', () => {
    it('resolves with accumulated body and response metadata on success', async () => {
      const { svc } = makeService();

      const requestSpy = jest
        .spyOn(https, 'request')
        .mockImplementation((options: any, callback: any) => {
          const req = new EventEmitter() as any;
          req.end = jest.fn();

          const res = new EventEmitter() as any;
          res.statusCode = 201;
          res.headers = { 'content-type': 'text/plain' };

          // Simulate async response
          setImmediate(() => {
            callback(res);
            res.emit('data', Buffer.from('foo'));
            res.emit('data', Buffer.from('bar'));
            res.emit('end');
          });

          return req;
        });

      const url = new URL('https://example.com/path?x=1');
      const out = await asAny(svc).httpsRequest(url, {
        method: 'GET',
        headers: { A: 'B' },
      });

      expect(out).not.toBeNull();
      expect(out\!.statusCode).toBe(201);
      expect(out\!.headers).toEqual({ 'content-type': 'text/plain' });
      expect(out\!.body.toString()).toBe('foobar');

      expect(requestSpy).toHaveBeenCalledTimes(1);
      const [calledOpts] = asAny(requestSpy.mock.calls[0]);
      expect(calledOpts.hostname).toBe('example.com');
      expect(calledOpts.port).toBe(443);
      expect(calledOpts.path).toBe('/path?x=1');
      expect(calledOpts.method).toBe('GET');
      expect(calledOpts.headers).toEqual({ A: 'B' });
    });

    it('resolves to null and logs error when request emits an error', async () => {
      const { svc } = makeService();

      jest.spyOn(https, 'request').mockImplementation((options: any, callback: any) => {
        const req = new EventEmitter() as any;
        req.end = jest.fn(() => {
          // On end, emit an error
          setImmediate(() => {
            req.emit('error', new Error('netdown'));
          });
        });
        return req;
      });

      const url = new URL('https://example.com/');
      const out = await asAny(svc).httpsRequest(url, {
        method: 'GET',
        headers: {},
      });

      expect(out).toBeNull();
      expect(logger.error).toHaveBeenCalledWith(
        expect.stringContaining('HTTPS request failed: netdown'),
      );
    });
  });
});