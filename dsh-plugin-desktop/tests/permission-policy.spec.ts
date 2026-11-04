import { describe, expect, it, vi } from 'vitest'
import { installPermissionPolicy, permissionAllowed, type PermissionSession } from '../src/permission-policy.ts'

const APP = 'http://127.0.0.1:52899'

describe('permission policy', () => {
  it('gives the app its own microphone and notifications', () => {
    expect(permissionAllowed({ permission: 'media', requester: `${APP}/chat`, appOrigin: APP, mediaTypes: ['audio'] })).toBe(true)
    expect(permissionAllowed({ permission: 'notifications', requester: `${APP}/`, appOrigin: APP })).toBe(true)
    expect(permissionAllowed({ permission: 'clipboard-sanitized-write', requester: `${APP}/`, appOrigin: APP })).toBe(true)
  })

  it('refuses the camera, even to the app', () => {
    expect(permissionAllowed({ permission: 'media', requester: `${APP}/`, appOrigin: APP, mediaTypes: ['video'] })).toBe(false)
    expect(permissionAllowed({ permission: 'media', requester: `${APP}/`, appOrigin: APP, mediaTypes: ['audio', 'video'] })).toBe(false)
  })

  it.each(['geolocation', 'midi', 'midiSysex', 'clipboard-read', 'pointerLock', 'openExternal', 'display-capture', 'fullscreen', 'unknown'])(
    'refuses %s to the app',
    (permission) => { expect(permissionAllowed({ permission, requester: `${APP}/`, appOrigin: APP })).toBe(false) },
  )

  it.each([
    'https://attacker.example/',
    'http://127.0.0.1:1/',
    'http://localhost:52899/',
    'http://127.0.0.1.attacker.example:52899/',
    'file:///tmp/x.html',
    'data:text/html,x',
    '',
    'not a url',
  ])('refuses the microphone and notifications to %s', (requester) => {
    expect(permissionAllowed({ permission: 'media', requester, appOrigin: APP, mediaTypes: ['audio'] })).toBe(false)
    expect(permissionAllowed({ permission: 'notifications', requester, appOrigin: APP })).toBe(false)
  })

  it('refuses everything before the Host is up', () => {
    expect(permissionAllowed({ permission: 'notifications', requester: `${APP}/`, appOrigin: undefined })).toBe(false)
  })

  it('installs both handlers, and follows the origin across Host generations', () => {
    let request: Parameters<PermissionSession['setPermissionRequestHandler']>[0] | undefined
    let check: Parameters<PermissionSession['setPermissionCheckHandler']>[0] | undefined
    let origin: string | undefined = APP
    installPermissionPolicy({
      setPermissionRequestHandler: (handler) => { request = handler },
      setPermissionCheckHandler: (handler) => { check = handler },
    }, () => origin)

    const answer = vi.fn()
    request?.({}, 'media', answer, { requestingUrl: `${APP}/x`, mediaTypes: ['audio'] })
    expect(answer).toHaveBeenLastCalledWith(true)
    request?.({}, 'media', answer, { requestingUrl: 'https://attacker.example/', mediaTypes: ['audio'] })
    expect(answer).toHaveBeenLastCalledWith(false)
    expect(check?.({}, 'media', APP, { mediaType: 'audio' })).toBe(true)
    expect(check?.({}, 'media', APP, { mediaType: 'video' })).toBe(false)
    expect(check?.({}, 'media', 'https://attacker.example', { mediaType: 'audio' })).toBe(false)

    origin = 'http://127.0.0.1:60000'
    request?.({}, 'notifications', answer, { requestingUrl: `${APP}/` })
    expect(answer).toHaveBeenLastCalledWith(false)
  })
})
