'use client'

import * as React from 'react'

export function useSearchParam(name: string): string | null {
  const [value, setValue] = React.useState<string | null>(null)
  React.useEffect(() => {
    const read = () => setValue(new URLSearchParams(window.location.search).get(name))
    read()
    window.addEventListener('popstate', read)
    return () => window.removeEventListener('popstate', read)
  }, [name])
  return value
}

export function useDebouncedValue<T>(value: T, delay = 250): T {
  const [debounced, setDebounced] = React.useState(value)
  React.useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delay)
    return () => clearTimeout(timer)
  }, [value, delay])
  return debounced
}
