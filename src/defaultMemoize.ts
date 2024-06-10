import type { EqualityFn } from './types'

// Cache implementation based on Erik Rasmussen's `lru-memoize`:
// https://github.com/erikras/lru-memoize

const NOT_FOUND = 'NOT_FOUND'
type NOT_FOUND_TYPE = typeof NOT_FOUND

interface Entry {
  key: unknown
  value: unknown
}

interface Cache {
  get(key: unknown): unknown | NOT_FOUND_TYPE
  put(key: unknown, value: unknown): void
  getEntries(): Entry[]
  clear(): void
}

class SingletonCache implements Cache {
  private entry: Entry | undefined

  constructor(private equals: EqualityFn) {
  }

  get(key: unknown) {
    if (this.entry && this.equals(this.entry.key, key)) {
      return this.entry.value
    }

    return NOT_FOUND
  }

  put(key: unknown, value: unknown) {
    this.entry = { key, value }
  }

  getEntries() {
    return this.entry ? [this.entry] : []
  }

  clear() {
    this.entry = undefined
  }
}

function createSingletonCache(equals: EqualityFn): Cache {
  return new SingletonCache(equals)
}

class LruCache implements Cache {
  private entries: Entry[] = []

  constructor(private maxSize: number, private equals: EqualityFn) {
  }

  get(key: unknown) {
    const cacheIndex = this.entries.findIndex(entry => this.equals(key, entry.key))

    // We found a cached entry
    if (cacheIndex > -1) {
      const entry = this.entries[cacheIndex]

      // Cached entry not at top of cache, move it to the top
      if (cacheIndex > 0) {
        this.entries.splice(cacheIndex, 1)
        this.entries.unshift(entry)
      }

      return entry.value
    }

    // No entry found in cache, return sentinel
    return NOT_FOUND
  }

  put(key: unknown, value: unknown) {
    if (this.get(key) === NOT_FOUND) {
      // TODO Is unshift slow?
      this.entries.unshift({ key, value })
      if (this.entries.length > this.maxSize) {
        this.entries.pop()
      }
    }
  }

  getEntries() {
    return this.entries
  }

  clear() {
    this.entries = []
  }
}

function createLruCache(maxSize: number, equals: EqualityFn): Cache {
  return new LruCache(maxSize, equals)
}

export const defaultEqualityCheck: EqualityFn = (a, b): boolean => {
  return a === b
}

export function createCacheKeyComparator(equalityCheck: EqualityFn) {
  return function areArgumentsShallowlyEqual(
    prev: unknown[] | IArguments | null,
    next: unknown[] | IArguments | null
  ): boolean {
    if (prev === null || next === null || prev.length !== next.length) {
      return false
    }

    // Do this in a for loop (and not a `forEach` or an `every`) so we can determine equality as fast as possible.
    const length = prev.length
    for (let i = 0; i < length; i++) {
      if (!equalityCheck(prev[i], next[i])) {
        return false
      }
    }

    return true
  }
}

export interface DefaultMemoizeOptions {
  equalityCheck?: EqualityFn
  resultEqualityCheck?: EqualityFn
  maxSize?: number
}

// defaultMemoize now supports a configurable cache size with LRU behavior,
// and optional comparison of the result value with existing values
export function defaultMemoize<F extends (...args: any[]) => any>(
  func: F,
  equalityCheckOrOptions?: EqualityFn | DefaultMemoizeOptions
) {
  const providedOptions =
    typeof equalityCheckOrOptions === 'object'
      ? equalityCheckOrOptions
      : { equalityCheck: equalityCheckOrOptions }

  const {
    equalityCheck = defaultEqualityCheck,
    maxSize = 1,
    resultEqualityCheck
  } = providedOptions

  const comparator = createCacheKeyComparator(equalityCheck)

  const cache =
    maxSize === 1
      ? createSingletonCache(comparator)
      : createLruCache(maxSize, comparator)

  // we reference arguments instead of spreading them for performance reasons
  function memoized() {
    let value = cache.get(arguments)
    if (value === NOT_FOUND) {
      // @ts-ignore
      value = func.apply(null, arguments)

      if (resultEqualityCheck) {
        const entries = cache.getEntries()
        const matchingEntry = entries.find(entry =>
          resultEqualityCheck(entry.value, value)
        )

        if (matchingEntry) {
          value = matchingEntry.value
        }
      }

      cache.put(arguments, value)
    }
    return value
  }

  memoized.clearCache = () => cache.clear()

  return memoized as F & { clearCache: () => void }
}
