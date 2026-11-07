/**
 * Browser half of dsh-account-odometer.
 *
 * Adds one entry to the `conversation.composer.dock` list slot — the row under
 * the composer that already shows the token/cache and context readings — with
 *
 *   Balance <account wallet>  ·  Session <estimated spend>
 *
 * The balance comes from the account Remote namespace (`account/getBalance`),
 * which is the same read the Account settings page performs. The spend is
 * estimated client-side from the durable `tokenUsage` Session projection
 * (whole-log uncached input, cache-read, cache-write and output tokens) times
 * the per-million-token rates in RATES below.
 *
 * Change RATES to match your provider's published prices; everything else is
 * derived. A failed or unavailable reading only hides this entry — it never
 * affects the rest of the composer.
 */
window.__ModuleLoader__.load({
  id: 'dsh-account-odometer',
  factory: (require) => {
    var module = { exports: {} }
    var exports = module.exports
    Object.defineProperty(exports, Symbol.toStringTag, { value: 'Module' })

    const react = require('react')

    /**
     * USD per one million tokens, DeepSeek published list prices.
     * `cacheWrite` has no separate published price; it is billed like a miss.
     */
    const RATES = Object.freeze({
      input: 0.28,
      cacheRead: 0.028,
      cacheWrite: 0.28,
      output: 0.42,
    })

    /** How often the balance is re-read, in milliseconds. */
    const REFRESH_MS = 60_000

    /** Slot entry id; also the `data-composer-stat` marker. */
    const DOCK_ID = 'account-odometer'

    /**
     * DSH release string reported to Platform as the calling client version.
     * Purely descriptive: Platform stores it and never gates on it. Read from
     * the boot graph so it follows upgrades without a rebuild.
     */
    function clientVersion() {
      try {
        const boot = window.__DSH_BOOT__
        if (boot && boot.release && boot.release.version) return boot.release.version
      } catch (_) {
        /* boot graph unavailable */
      }
      return '0.2.2-rc.1'
    }

    const CURRENCY_SYMBOL = { USD: '$', CNY: '¥' }

    const STYLE = {
      display: 'inline-flex',
      alignItems: 'center',
      gap: '6px',
      fontSize: '12px',
      lineHeight: '18px',
      color: 'var(--dsw-alias-label-tertiary)',
      whiteSpace: 'nowrap',
      fontVariantNumeric: 'tabular-nums',
    }

    const SEPARATOR_STYLE = {
      opacity: 0.6,
      margin: '0 2px',
    }

    /** Build the identity the account controller forwards to Platform. */
    function clientMetadata() {
      let locale = 'en'
      try {
        locale = document.documentElement.lang || navigator.language || 'en'
      } catch (_) {
        /* non-browser evaluation */
      }
      return {
        version: clientVersion(),
        locale,
        timezoneOffsetSeconds: -new Date().getTimezoneOffset() * 60,
      }
    }

    /** Compact grouping for token counts in the tooltip. */
    function group(value) {
      try {
        return Number(value || 0).toLocaleString('en-US')
      } catch (_) {
        return String(value || 0)
      }
    }

    /** Estimated USD spend for one `tokenUsage` projection value. */
    function spendOf(usage) {
      if (!usage) return null
      const input = Number(usage.uncachedInputTokens) || 0
      const cacheRead = Number(usage.cacheReadTokens) || 0
      const cacheWrite = Number(usage.cacheWriteTokens) || 0
      const output = Number(usage.outputTokens) || 0
      if (input + cacheRead + cacheWrite + output === 0) return 0
      return (
        (input * RATES.input +
          cacheRead * RATES.cacheRead +
          cacheWrite * RATES.cacheWrite +
          output * RATES.output) /
        1_000_000
      )
    }

    /** `$0.0042` under a cent, `$1.23` above it: an odometer keeps the small digits. */
    function formatSpend(value) {
      if (value === null || !Number.isFinite(value)) return null
      if (value === 0) return '$0.00'
      if (value < 0.01) return '$' + value.toFixed(4)
      return '$' + value.toFixed(2)
    }

    /** Platform display rules: two decimals, positive sub-cent as `<0.01`. */
    function formatMoney(text) {
      const value = Number(text)
      if (!Number.isFinite(value)) return String(text)
      if (value > 0 && value < 0.01) return '<0.01'
      return value.toFixed(2)
    }

    /** One wallet row per currency; null when the balance is not readable. */
    function balanceText(balance) {
      if (balance === undefined || balance === null) return null
      if (balance.status !== 'ready') return null
      const wallets = Array.isArray(balance.value) ? balance.value : []
      if (wallets.length === 0) return null
      return wallets
        .map((wallet) => {
          const symbol = CURRENCY_SYMBOL[wallet.currency] ?? String(wallet.currency || '') + ' '
          return symbol + formatMoney(wallet.balance)
        })
        .join(' / ')
    }

    /** Bonus credit, shown only when positive. */
    function bonusText(balance) {
      if (!balance || balance.status !== 'ready') return null
      const wallets = Array.isArray(balance.bonusWallets) ? balance.bonusWallets : []
      const positive = wallets.filter((wallet) => Number(wallet.balance) > 0)
      if (positive.length === 0) return null
      return positive
        .map((wallet) => {
          const symbol = CURRENCY_SYMBOL[wallet.currency] ?? String(wallet.currency || '') + ' '
          return symbol + formatMoney(wallet.balance)
        })
        .join(' / ')
    }

    /**
     * Keep one broken reading from taking the composer down with it.
     */
    class Guard extends react.Component {
      constructor(props) {
        super(props)
        this.state = { failed: false }
      }

      static getDerivedStateFromError() {
        return { failed: true }
      }

      componentDidCatch(error) {
        console.error('[account-odometer]', error)
      }

      render() {
        return this.state.failed ? null : this.props.children
      }
    }

    /**
     * Mount the dock entry.
     * @param ctx - Client plugin context.
     */
    function apply(ctx) {
      /** Latest balance outcome: undefined while unread, null when absent. */
      let latestBalance
      /** Wall clock of the last Platform read, so token growth cannot flood it. */
      let lastRead = 0
      const MIN_READ_GAP_MS = 20_000

      function readBalance() {
        if (Date.now() - lastRead < MIN_READ_GAP_MS) return Promise.resolve(latestBalance)
        lastRead = Date.now()
        let account
        try {
          account = ctx.remote && ctx.remote.account
        } catch (_) {
          /* service not injected after all: fall back to the session reading */
          account = undefined
        }
        if (!account || typeof account.getBalance !== 'function') {
          latestBalance = null
          return Promise.resolve(null)
        }
        return account
          .getBalance(clientMetadata())
          .then((result) => {
            latestBalance = result && result.ok === true ? result.value ?? null : null
            return latestBalance
          })
          .catch(() => {
            latestBalance = null
            return null
          })
      }

      function Odometer({ useProjection }) {
        const usage = typeof useProjection === 'function' ? useProjection('tokenUsage') : undefined
        const spend = spendOf(usage)
        const [balance, setBalance] = react.useState(latestBalance)
        const total = usage
          ? (Number(usage.uncachedInputTokens) || 0) +
            (Number(usage.cacheReadTokens) || 0) +
            (Number(usage.cacheWriteTokens) || 0) +
            (Number(usage.outputTokens) || 0)
          : 0

        /* Re-read on mount, after every priced change, and on a slow timer. */
        react.useEffect(() => {
          let alive = true
          const run = () => {
            void readBalance().then((value) => {
              if (alive) setBalance(value)
            })
          }
          run()
          /* The account namespace may attach a moment after this plugin. */
          const retry = setTimeout(run, 3_000)
          const timer = setInterval(run, REFRESH_MS)
          return () => {
            alive = false
            clearTimeout(retry)
            clearInterval(timer)
          }
        }, [total])

        const balanceReading = balanceText(balance)
        const spendReading = formatSpend(spend)
        if (balanceReading === null && spendReading === null) return null

        const children = []
        if (balanceReading !== null) children.push('Balance ' + balanceReading)
        if (spendReading !== null) {
          if (children.length > 0) {
            children.push(
              react.createElement(
                'span',
                { key: 'sep', style: SEPARATOR_STYLE, 'aria-hidden': true },
                '·',
              ),
            )
          }
          children.push('session ≈' + spendReading)
        }

        const lines = ['Balance and this session’s estimated spend']
        if (balance && balance.status === 'ready') {
          const bonus = bonusText(balance)
          if (bonus !== null) lines.push('Granted credit ' + bonus)
        }
        if (usage) {
          lines.push(
            'tokens in ' +
              group(usage.uncachedInputTokens) +
              ' · cache hit ' +
              group(usage.cacheReadTokens) +
              ' · cache write ' +
              group(usage.cacheWriteTokens) +
              ' · out ' +
              group(usage.outputTokens),
            'rates per 1M: in $' +
              RATES.input +
              ' · cache $' +
              RATES.cacheRead +
              ' · out $' +
              RATES.output +
              ' (estimate from tokenUsage)',
          )
        }

        return react.createElement(
          'span',
          {
            'data-composer-stat': DOCK_ID,
            style: STYLE,
            title: lines.join('\n'),
          },
          ...children,
        )
      }

      ctx.slots.inject('conversation.composer.dock', () =>
        ctx.slots.register(
          {
            name: 'conversation.composer.dock',
            id: DOCK_ID,
            order: 2,
          },
          (props) =>
            react.createElement(Guard, null, react.createElement(Odometer, props)),
        ),
      )
    }

    /*
     * `remote.account` is a distinct service name in the client kernel: reading
     * `ctx.remote.account` without declaring it throws. Declaring it keeps this
     * plugin pending only while an account provider is composed at all.
     */
    const inject = ['slots', 'remote', 'remote.account']

    exports.apply = apply
    exports.inject = inject
    return module.exports
  },
})
