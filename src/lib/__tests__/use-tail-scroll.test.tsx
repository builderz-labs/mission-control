import { describe, expect, it } from 'vitest'
import { act, render, screen } from '@testing-library/react'
import { useRef } from 'react'
import { useTailScroll } from '@/lib/use-tail-scroll'

/** jsdom gives every element a zero-height layout, so the box is faked. */
function makeScrollable(node: HTMLElement, { scrollHeight = 1000, clientHeight = 200 } = {}) {
  Object.defineProperty(node, 'scrollHeight', { value: scrollHeight, configurable: true })
  Object.defineProperty(node, 'clientHeight', { value: clientHeight, configurable: true })
}

function Harness({ threadId, count }: { threadId: string; count: number }) {
  const ref = useRef<HTMLDivElement>(null)
  const { following, jumpToLatest } = useTailScroll(ref, { key: threadId, count })
  return (
    <>
      <div ref={ref} data-testid="scroller" />
      <span data-testid="following">{String(following)}</span>
      <button type="button" onClick={jumpToLatest}>
        Jump
      </button>
    </>
  )
}

function scroller(): HTMLElement {
  return screen.getByTestId('scroller')
}

describe('useTailScroll', () => {
  it('opens a thread at its newest content rather than the first message', () => {
    const { rerender } = render(<Harness threadId="a" count={0} />)
    makeScrollable(scroller())
    rerender(<Harness threadId="a" count={12} />)
    expect(scroller().scrollTop).toBe(1000)
    expect(screen.getByTestId('following').textContent).toBe('true')
  })

  it('stops following once the reader scrolls up to read history', () => {
    const { rerender } = render(<Harness threadId="a" count={1} />)
    const node = scroller()
    makeScrollable(node)

    node.scrollTop = 100
    act(() => {
      node.dispatchEvent(new Event('scroll'))
    })
    expect(screen.getByTestId('following').textContent).toBe('false')

    rerender(<Harness threadId="a" count={2} />)
    expect(node.scrollTop).toBe(100)
  })

  it('re-pins when the reader asks to jump to the latest message', () => {
    render(<Harness threadId="a" count={1} />)
    const node = scroller()
    makeScrollable(node)

    node.scrollTop = 100
    act(() => {
      node.dispatchEvent(new Event('scroll'))
    })
    act(() => {
      screen.getByRole('button', { name: 'Jump' }).click()
    })
    expect(node.scrollTop).toBe(1000)
    expect(screen.getByTestId('following').textContent).toBe('true')
  })

  it('re-pins when another thread is opened', () => {
    const { rerender } = render(<Harness threadId="a" count={1} />)
    const node = scroller()
    makeScrollable(node)

    node.scrollTop = 100
    act(() => {
      node.dispatchEvent(new Event('scroll'))
    })
    expect(screen.getByTestId('following').textContent).toBe('false')

    rerender(<Harness threadId="b" count={5} />)
    expect(node.scrollTop).toBe(1000)
    expect(screen.getByTestId('following').textContent).toBe('true')
  })

  it('keeps following while the reader sits near the bottom', () => {
    render(<Harness threadId="a" count={1} />)
    const node = scroller()
    makeScrollable(node)

    node.scrollTop = 780
    act(() => {
      node.dispatchEvent(new Event('scroll'))
    })
    expect(screen.getByTestId('following').textContent).toBe('true')
  })
})
