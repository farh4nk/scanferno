/**
 * Mount the self-hosted Matterport Showcase (Bundle SDK) in an iframe and connect to it.
 *
 * The bundle is copied into public/bundle by `npm install` (postinstall). It must be the Bundle SDK, not
 * the embed SDK: only the bundle exposes `sdk.Scene` (Showcase's three.js scene), which every overlay
 * in this package draws into. The SDK key is domain-locked (localhost works for dev).
 */
import type { MpSdk } from 'mp-sdk'

export type { MpSdk }

export interface ShowcaseOptions {
  modelId: string
  sdkKey: string
  /** Where the bundle's showcase.html is served. */
  bundlePath?: string
  /** Extra Showcase URL params (https://support.matterport.com/s/article/URL-Parameters). */
  params?: Record<string, string | number>
}

export interface Showcase {
  sdk: MpSdk
  iframe: HTMLIFrameElement
  modelId: string
  destroy(): void
}

type BundleWindow = Window & { MP_SDK: { connect(w: Window, opts?: object): Promise<MpSdk> } }

const DEFAULT_PARAMS = { play: 1, qs: 1, brand: 0, title: 0, help: 0, mls: 2, dh: 1, hr: 1, tourcta: 0 }

export async function mountShowcase(container: HTMLElement, opts: ShowcaseOptions): Promise<Showcase> {
  if (!opts.sdkKey) throw new Error('No Matterport SDK key: set MATTERPORT_SDK_KEY in the repo-root .env')
  const qs = new URLSearchParams({
    ...Object.fromEntries(Object.entries({ ...DEFAULT_PARAMS, ...opts.params }).map(([k, v]) => [k, String(v)])),
    m: opts.modelId,
    applicationKey: opts.sdkKey,
  })
  const iframe = document.createElement('iframe')
  iframe.allow = 'fullscreen; xr-spatial-tracking'
  iframe.style.cssText = 'width:100%;height:100%;border:0;display:block'
  iframe.src = `${opts.bundlePath ?? '/bundle/showcase.html'}?${qs}`
  const loaded = new Promise<void>((resolve) => iframe.addEventListener('load', () => resolve(), { once: true }))
  container.appendChild(iframe)
  await loaded

  const w = iframe.contentWindow as BundleWindow
  const sdk = await w.MP_SDK.connect(w)
  await sdk.App.state.waitUntil((s: { phase: string }) => s.phase === sdk.App.Phase.PLAYING)
  return {
    sdk,
    iframe,
    modelId: opts.modelId,
    destroy() {
      try {
        sdk.disconnect()
      } catch {
        // iframe may already be gone
      }
      iframe.remove()
    },
  }
}

export type View = 'dollhouse' | 'floorplan' | 'inside'

export async function setView(sdk: MpSdk, view: View): Promise<void> {
  const M = sdk.Mode.Mode
  await sdk.Mode.moveTo({ dollhouse: M.DOLLHOUSE, floorplan: M.FLOORPLAN, inside: M.INSIDE }[view])
}

/** Resolve once an observable collection (Room.data, Sweep.data, ...) has delivered its first snapshot. */
export function collection<T>(map: { subscribe(o: { onCollectionUpdated(c: Record<string, T>): void }): { cancel(): void } },
  timeoutMs = 5000): Promise<T[]> {
  return new Promise((resolve) => {
    let done = false
    let sub: { cancel(): void } | undefined
    const finish = (items: T[]) => {
      if (done) return
      done = true
      setTimeout(() => sub?.cancel())
      resolve(items)
    }
    sub = map.subscribe({ onCollectionUpdated: (c) => finish(Object.values(c)) })
    setTimeout(() => finish([]), timeoutMs)
  })
}
