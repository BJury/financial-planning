# UK Retirement Planner — Product & Technical Specification

Status: Draft v0.1
Owner: TBD
Last updated: 2026-07-18

## 0. Important caveat

This tool produces **illustrative projections**, not financial advice. UK tax
rules, allowances, and thresholds change at least once a year (typically at
the Spring/Autumn Budget and each new tax year on 6 April). The 2026/27
figures in §6.1 were pulled directly from gov.uk during the writing of this
spec (sources listed in §6.1) and should be correct as of today, but they
must still be re-verified against current HMRC guidance immediately before
each release — both because rates can change intra-year and because these
particular figures were captured by an automated fetch-and-summarise pass
over gov.uk pages, not a line-by-line manual read of primary legislation, so
treat them as a strong starting point rather than a guarantee. The product
must make it trivial to update these values without a code release (see §6).
The app must carry a persistent disclaimer that it is not regulated
financial advice and does not constitute a personal recommendation under
FCA rules.

---

## 1. Purpose & Goals

Let a UK-based individual enter their financial situation — income, savings,
pensions, investments, debts, and expected future cash events — and see a
year-by-year projection of their net worth and retirement income, with UK tax
rules (Income Tax, National Insurance, dividend tax, Capital Gains Tax,
pension tax relief, and the State Pension) correctly applied at each step.

### 1.1 Goals

- Model the accumulation phase (working life, saving/investing) and the
  decumulation phase (retirement, drawing down) in one continuous timeline.
- Apply UK tax rules accurately enough to be directionally trustworthy —
  correct band/allowance logic, not necessarily penny-perfect edge cases.
- Let users see the effect of decisions: contribute more to a pension vs an
  ISA, retire at 60 vs 68, overpay the mortgage vs invest, take a lump sum,
  etc.
- Keep tax-rule data separate from application-logic code so a new tax
  year's rates can be added as a pure data change rather than a
  calculation-logic rewrite (see §6, §6.2) — though, per the next point,
  it still requires a new build/deploy of the static site to reach users,
  since there's no backend to push a data-only update to at runtime.
- **Run entirely as a static site with no backend** — no server ever
  receives, stores, or processes the user's financial data; all
  calculation happens in the browser and all persistence is local to the
  user's own machine (§9.1, §9.2). This is a deliberate, load-bearing
  product decision, not just an implementation detail: it's what lets
  people enter sensitive financial detail into the tool without having to
  trust an operator with it.

### 1.2 Non-goals (v1)

- Not a substitute for regulated financial advice; no personalised
  recommendations ("you should do X").
- **English Income Tax rules only.** No Scottish Income Tax bands (the
  Scottish Parliament sets its own rates, distinct from the rest of the
  UK) — a Scottish taxpayer using this tool would get an incorrect Income
  Tax result. No region selector, no per-region tax table (§6). All other
  taxes modelled (NI, dividend tax, CGT, pension rules, property rules)
  are UK-wide and correct regardless of which UK nation the user lives in
  — it is specifically Income Tax band/rate selection that's out of scope.
- **No user accounts, login, or cross-device sync.** A plan lives in one
  browser's local storage plus whatever file the user has exported (§9.2)
  — moving to a different browser or device means manually carrying that
  file across, not signing in elsewhere.
- Supports at most **two people per household** (an individual or a
  couple); modelling dependents/children as separate financial actors, or
  households of three or more adults, is out of scope for v1 (see
  Roadmap).
- Not Monte Carlo / stochastic market modelling in v1 — deterministic growth
  rate assumptions only (see Roadmap).
- Not a full self-assessment tax return calculator — self-employment
  income is out of scope for v1 (rental and investment income, unlike
  self-employment, *are* modelled, §3.6, §3.8).
- No student loan repayment deductions (Plan 1/2/4/5, Postgraduate Loan)
  or High Income Child Benefit Charge modelling in v1 — both are real
  payroll/tax mechanics, but neither is needed for a first release; see
  Roadmap, §14.
- No live brokerage/pension provider integration (Open Banking / pension
  dashboard APIs) in v1 — all figures are user-entered.

### 1.3 Target users

English taxpayers who want a self-serve, "what if" retirement projection
tool. The tool applies English Income Tax rates and bands only — Scotland
has its own distinct Income Tax bands set by the Scottish Parliament, and
supporting them is explicitly out of scope for v1 (§1.2). All non-Income-Tax
rules (NI, dividend tax, CGT, pension rules) are UK-wide and unaffected by
this. Assume financially literate but not tax-expert users.

The tool must support both a **single-person plan** and a **two-person
(couple) household plan** as first-class modes, not household-as-an-
afterthought — UK retirement planning is frequently a joint exercise
(shared mortgage, Marriage Allowance, splitting withdrawals across two
people's tax allowances), and modelling only individuals would miss the
scenario most couples actually want answered: "between the two of us, how
much will we have, and how should we draw it down?" A two-person household
does **not** require the two people to be married/in a civil partnership —
some couple-specific tax mechanics (Marriage Allowance, interspousal
CGT-free transfers) only apply if they are, and the tool must ask this
explicitly rather than assume it (§3.1).

---

## 2. Glossary

| Term | Meaning |
|---|---|
| AA | Annual Allowance (pension contribution limit, §5.4) |
| CGT | Capital Gains Tax |
| CPI | Consumer Price Index — the basis for the inflation assumption (§3.10) |
| DC pension | Defined Contribution pension (workplace auto-enrolment or personal) |
| FCA | Financial Conduct Authority — the UK's financial services regulator (§10) |
| GIA | General Investment Account (unwrapped, taxable) |
| HMO | House in Multiple Occupation (§11, §14 — not modelled in v1) |
| HMRC | HM Revenue & Customs — the UK tax authority |
| IHT | Inheritance Tax (§11, §14 — not modelled in v1) |
| ISA | Individual Savings Account (tax-free wrapper) |
| LISA | Lifetime ISA — an ISA variant with a 25% government bonus and its own rules (§3.5) |
| LSA | Lump Sum Allowance (tax-free pension cash limit, tracked as a lifetime running total, §5.4, §5.7.2) |
| LSDBA | Lump Sum and Death Benefit Allowance |
| MPAA | Money Purchase Annual Allowance (reduced AA after flexibly accessing a pension) |
| NI | National Insurance |
| NMPA | Normal Minimum Pension Age — the earliest age a pension can normally be accessed without a tax charge (§5.7) |
| PRR | Private Residence Relief — full CGT exemption on the sale of a qualifying main home (§5.6) |
| PSA | Personal Savings Allowance — tax-free interest income, amount varies by Income Tax band (§5.5) |
| SIPP | Self-Invested Personal Pension |
| SP | State Pension |
| SPA | State Pension Age — when State Pension can first be claimed, based on date of birth (§3.3, §5.7) |
| Tax year | 6 April to 5 April |
| UEL | Upper Earnings Limit — the NI threshold above which the lower NI rate applies (§5.3) |
| UFPLS | Uncrystallised Funds Pension Lump Sum — a way of drawing a pension where each withdrawal is automatically split tax-free/taxable, as opposed to crystallising a lump sum upfront (§5.7.2) |

---

## 3. User Inputs

### 3.1 Household structure
The very first input: is this plan for **one person** or **two people**?
For a two-person household, additionally capture:
- Relationship status: married/civil partnership, or unmarried
  (co-habiting) — this gates whether Marriage Allowance transfer (§5.2)
  and CGT-free interspousal asset transfers (§5.5) are available, since
  both are marriage/civil-partnership-only reliefs in UK tax law.
- Whether the two people want a **combined household target retirement
  income** (default, and generally the more useful framing for a couple)
  or two independent target incomes.

Everything in §3.2–§3.7 below is captured **per person** where the item is
individually owned (salary, pension, State Pension, ISA — these cannot be
jointly owned under UK tax rules), and captured **once per household** with
an explicit owner field where the item can be jointly held (mortgage,
property, GIA, cash savings, one-off cash events). The data model reflects
this with a `Person` entity and an `owner` field on `Account`,
`IncomeSource`, and `IncomeDrain` (§3.11, §8) that is either a specific
Person or `Joint`.

### 3.2 Personal details (per person)
- Date of birth (drives State Pension age and age-based logic)
- Current gross annual salary (employment income, already in today's
  terms), and an expected annual (nominal) growth rate — e.g. "in line
  with inflation" (0% real) or a custom % (§3.10)
- Target retirement age — a convenience default only: it pre-fills the
  start age of this person's `TargetDrawdownIncome` (§3.11, §5.7.1) and the
  end age of their Salary Income Source when those are first added. It is
  not itself read by the simulation loop — what actually puts a person
  "in decumulation" for a given year is whether they have an active
  `TargetDrawdownIncome` that year (§5.1), so changing this field after
  those items exist has no effect unless the user also updates them.
- Life expectancy / projection end age (default e.g. 95, user-editable) —
  for a two-person household this also determines survivor periods (one
  person's income/expenses continuing after the other's projection end
  age), which materially affects the tail of the household projection

### 3.3 State Pension (per person)
- **Entering a known forecast amount is the primary, recommended path**
  (from the user's own gov.uk "Check your State Pension forecast" page) —
  the UI should lead with this option, not present it as a fallback.
- **Estimation formula, for anyone who doesn't have their forecast to
  hand**: `qualifying years to date` (user-entered) `+ years remaining
  until State Pension age` (assuming continued full-rate NI contributions
  or credits each year until SPA or until their Salary Income Source
  ends, whichever is earlier), capped at `qualifyingYearsForFull` (§6.1).
  Projected weekly amount = `fullWeeklyAmount × min(projected qualifying
  years, qualifyingYearsForFull) / qualifyingYearsForFull`, or £0 if
  projected qualifying years falls below `qualifyingYearsMinimum`.
  - **This formula is only valid for someone whose entire NI record
    started on or after 6 April 2016.** The real UK State Pension
    calculation for anyone with NI contributions before that date
    involves a "starting amount" calculation — comparing the old and new
    scheme rules as they stood in April 2016 and taking the higher,
    including pre-2016 "contracted-out" deductions — that genuinely
    cannot be derived from the few inputs above; it requires the
    person's actual NI record, which only HMRC holds. The UI must
    surface this explicitly (e.g. "born before [year], or started
    working before April 2016? This estimate may be inaccurate — use
    your actual forecast instead") rather than silently applying the
    simplified formula to everyone. This is a deliberate v1
    simplification consistent with §1.1's "directionally trustworthy,
    not penny-perfect" goal, not an oversight.
- Any known gaps or voluntary contributions (adjusts qualifying years to
  date directly, before the estimation formula above runs).
- State Pension is always calculated per person from their own NI record —
  there is no joint/shared State Pension in the UK system, even for
  married couples (aside from legacy rules for those who reached SPA
  before April 2016, out of scope for v1).

### 3.4 Pensions (per person; one or more accounts, each typed as Workplace DC or SIPP/Personal)
- Owning person (pensions cannot be jointly held)
- Current pot value
- Employee contribution (% or £, and method: relief-at-source, net pay, or
  salary sacrifice — this changes the tax/NI mechanics, see §5.3)
- Employer contribution (% or £)
- Assumed annual growth rate and annual product/platform charge (%)
- There is no separate "drawdown strategy" field to fill in per pot — once
  the owning person has a `TargetDrawdownIncome` Income Source (§3.11,
  §5.7), the solver decides automatically, each year, how much (if any)
  tax-free cash and taxable income to draw from this pot alongside every
  other bucket available to that person. An optional override lets a user
  mark a specific pot as "leave invested until last" (e.g. a small legacy
  pot they want to preserve) or "crystallise fully at retirement" for
  cases where the default year-by-year solver isn't the behaviour they
  want.

### 3.5 ISAs (per person; one or more: Cash ISA, Stocks & Shares ISA, Lifetime ISA)
- Owning person (an ISA is always individually owned — there is no joint
  ISA; each person has their own annual subscription limit, §6.1)
- Current balance
- Annual contribution
- Assumed annual growth rate (0 for Cash ISA by default, or a modelled
  interest rate)
- For LISA: contributions stop being eligible for the 25% government bonus
  at age 50; withdrawals before 60 for non-house-purchase reasons incur a
  25% penalty — model both.

### 3.6 General Investment Accounts (unwrapped)
- Owner: a specific person, or `Joint` — a jointly-held GIA has its income
  and gains split 50/50 between the two people by default for tax purposes
  (HMRC's default assumption for married couples/civil partners; unmarried
  co-owners are taxed per actual beneficial ownership share, which the
  tool should let the user set explicitly instead of assuming 50/50, see
  §5.5)
- Current balance and unrealised gain (cost basis), for CGT purposes
- Annual contribution
- Assumed annual growth rate, and split between income (dividends/interest)
  and capital growth, since these are taxed differently

### 3.7 Cash savings
- Owner: a specific person, or `Joint` (split 50/50 for interest-tax
  purposes by default, as with a joint GIA)
- Current balance, assumed interest rate (taxable via the Personal
  Savings Allowance — note each person has their own PSA, so how a joint
  balance is split affects total household tax, §5.5)

### 3.8 Property & mortgage
The household can hold zero or more properties. Each property is entered
separately since a main residence and a rental property are taxed very
differently (§5.6):

- **Type**: main residence, or rental/buy-to-let, with any number of
  rental properties. The "at most one main residence" constraint for
  Private Residence Relief purposes (§5.6) applies **per married/civil-
  partnership couple**, not per household: a married/civil-partnership
  household can nominate at most one main residence between them, but an
  unmarried household (§3.1) can have up to one main-residence property
  per person, since each is a separate taxpayer under UK law and can each
  independently qualify for PRR on their own home.
- **Owner**: a specific person, or `Joint` — for a rental property this
  determines whose Income Tax the rental profit is assessed against (split
  per legal/beneficial ownership share, defaulting to 50/50 if jointly
  owned by a married/civil partnership couple, consistent with §3.6's GIA
  treatment).
- Current value and assumed annual growth rate (house price growth
  assumption, separate from investment growth assumptions).
- Original purchase price and purchase date (cost basis, needed for CGT if
  the property is ever sold at a gain, §5.6).
- **Associated mortgage** (optional — a property may be owned outright):
  outstanding balance, interest rate (fixed period + reversion rate),
  term/remaining months, repayment type (repayment vs interest-only),
  monthly payment (derived or user-entered), optional planned
  overpayments (regular or one-off). Modelled as a cash outflow during its
  term and a reduction to that property's net equity; **not itself
  taxed** — but for a rental property, mortgage *interest* feeds into the
  rental income tax calculation (§5.6), so interest and capital repayment
  must be tracked separately, not just as a single blended payment.
- **If rental**: expected gross annual rental income, letting costs
  (management/agent fees, maintenance, insurance, ground rent/service
  charge, void periods) — net rental profit before tax feeds into §5.6.
- **Planned sale** (optional, for either property type): an expected sale
  date (or age) and expected sale price (or "grow current value to sale
  date at the house price growth assumption"), plus estimated selling
  costs (agent + legal fees). On the modelled sale date, the engine
  redeems any outstanding mortgage against that property from the
  proceeds, applies CGT if applicable (§5.6), and adds the net proceeds
  to the owning person's (or household's) cash/GIA as a one-off event —
  functionally a system-generated `IncomeSource` of type
  `PropertySaleProceeds` (§3.11) rather than something the user has to
  also enter manually.
- For a two-person household with a jointly-funded mortgage, how the
  monthly payment is funded from the two individual cash-flow surpluses
  (e.g. proportional to income, or a fixed split) — this doesn't affect
  tax but does affect how much each person individually has left to
  contribute to their own pension/ISA.

### 3.9 One-off / irregular cash events
A flexible list of dated, one-off (or repeating-but-finite) cash movements
— added as `OneOffInflow` (Income Source) or `OneOffOutflow` (Income
Drain) instances, §3.11 — each with: date (or age), amount, owner (a
specific person, or `Joint`/household), and category — e.g. inheritance
received, house deposit paid, redundancy payment, gift given, wedding
cost, sabbatical (income drops to zero for N months). These feed directly
into the relevant account (cash, ISA, GIA) or into general net worth if
uncategorised. The category determines the `taxCategory`/`taxTreatment`
(§3.11) applied — e.g. an inheritance is typically `taxFree`, a
redundancy payment above £30,000 is `earnedIncome` for the excess — always
against the owning person's own tax position, never pooled, since Income
Tax is fundamentally individual in the UK even when the money ends up in a
joint account.

### 3.10 Assumptions (global, but overridable per-item where noted above)
- **Inflation rate**: a single flat CPI assumption (e.g. 2.5%/year), the
  one rate the whole engine uses to convert between nominal (actual future
  £) and real (present-day/today's-money £) terms. This is the central
  assumption the rest of this section — and the engine's whole approach to
  units, §5.8 — is built around: **all figures the user sees are in
  present-day terms**, and every rate of return the user enters is
  adjusted by this input before being used.
- **Growth/return rates** (pension, ISA, GIA, cash, property, salary,
  rental income — §3.2, §3.4–§3.8): entered by the user the way people
  naturally think about them — as an expected **nominal** rate (e.g. "I
  expect 6% average stock market growth", "my salary rises 3%/year") —
  and converted internally to a **real** rate using the inflation
  assumption, via `real = (1 + nominal) / (1 + inflation) − 1` (not the
  crude `nominal − inflation` subtraction, which is a reasonable
  approximation at low rates but visibly wrong at higher ones). An
  advanced toggle lets a user enter a rate directly as "real / above
  inflation" instead, for anyone who already thinks in those terms (e.g.
  "I want to assume 3% real growth") — skipping the conversion.
- **Tax threshold uprating assumption**: HMRC's own published rates for
  the current and any already-confirmed future tax years are nominal cash
  figures (§6) and are deflated to today's terms using the inflation
  assumption like everything else. But most of a long-horizon plan runs
  through tax years that haven't been set yet, so the user picks how
  thresholds beyond the latest confirmed tax year behave:
  - **Inflation-linked (default)**: thresholds keep pace with inflation,
    i.e. stay flat in real terms — in the engine's real-terms internal
    model this requires no calculation at all (§5.8), which is the
    simplifying benefit of working in real terms by default.
  - **Frozen in cash terms**: thresholds stay fixed in nominal £ (as UK
    policy has actually done to most Income Tax/NI thresholds since
    2021/22), which in real terms means they erode by roughly the
    inflation rate every year — this models ongoing "fiscal drag" and is
    the more realistic default to offer prominently given recent UK
    policy, even though "inflation-linked" is the simpler long-run
    assumption. Optionally bounded by an assumed freeze end date, after
    which uprating reverts to inflation-linked.
  - **Custom annual %**: a user-specified nominal uprating rate, applied
    the same way.
- Desired retirement income is **not** a separate assumption field — it is
  captured by adding a `TargetDrawdownIncome` Income Source (§3.11, §5.7),
  in today's money, scoped to one person or combined across the household
  per the choice made in §3.1. It's listed here only as a pointer, since
  it functions like the other global assumptions above (a single number
  that shapes the whole decumulation phase of the projection) even though
  it's technically a catalog item rather than a scenario-level field.

### 3.11 Composable income sources & drains (UI & architecture model)

Rather than a fixed, bespoke form per category, the UI for entering cash
*flows* — as distinct from the accounts/properties that hold value (§3.4–
§3.8) — is built around two generic, independently addable lists:
**Income Sources** (things that bring money in) and **Income Drains**
(things that take money out). Each is added via a small "+ Add income
source" / "+ Add drain" picker showing a catalog of available types; each
type renders its own small, self-contained input card (only the fields
that type needs) and can be edited or removed independently of every other
item on the list. This is a deliberate architectural choice, not just a
UI preference:

- **Cleaner UI**: one generic add/edit/remove list component serves every
  income and outgoing type, instead of a different bespoke screen per
  category — adding a new type later (§14) means adding a new catalog
  entry, not a new screen.
- **Independent testability**: each type is a small, pure, self-contained
  module — a short input schema plus a calculation function — that can be
  unit tested in complete isolation (given these inputs, for this
  simulated year, what amount does it contribute, and how) without
  spinning up the full year-by-year engine (§5.1, §12). This is the same
  design that makes the tax breakdown view (§4, journey 5) able to
  attribute each year's numbers back to a specific, named source or drain.
- **Explicit tax treatment, always**: every Income Source module must
  declare a `taxCategory` — never a bare "is this taxable" checkbox, since
  in UK tax *how* something is taxed matters as much as *whether it is*,
  and getting this wrong silently is the single easiest way for a tax
  engine to be quietly incorrect. The categories map directly onto the
  mechanics already defined in §5:
  - `taxFree` — e.g. an ISA withdrawal, a gift received, LISA growth
    (§5.5)
  - `earnedIncome` — salary; Income Tax **and** NI apply (§5.2, §5.3)
  - `pensionIncome` — pension drawdown income; Income Tax, no NI (§5.7)
  - `statePensionIncome` — paid gross, still consumes Personal Allowance
    (§5.2)
  - `rentalProfit` — Income Tax at marginal rate, with the mortgage-
    interest tax-credit quirk (§5.6)
  - `savingsInterest` — taxed via the Personal Savings Allowance (§5.5)
  - `dividendIncome` — taxed via the Dividend Allowance (§5.5)
  - `capitalGain` — CGT via the Annual Exempt Amount, at general or
    residential rates as applicable (§5.5, §5.6) — modelled at the point
    an Account/Property records a disposal rather than as a recurring
    Income Source, since a gain isn't a periodic cash flow the way the
    others are
  Every Income Drain module similarly declares a `taxTreatment`: `none`
  (not deductible — living expenses, a mortgage payment), or one of the
  three pension-contribution mechanics already defined in §5.4
  (`reducesTaxableIncomeNetPay`, `reducesTaxableIncomeAndNISalarySacrifice`,
  `reliefAtSourceBasicRateTopUp`). A module cannot be added to the catalog
  without one of these declared — there is no untagged/default case,
  precisely because an unlabelled cash flow is where correctness bugs hide.
- **Sources vs accounts stay distinct**: Income Sources/Drains are cash
  *flows* with a start/end (a date, an age, or "for life") — salary,
  rental income, State Pension, pension drawdown income, living expenses,
  a mortgage payment, a pension/ISA/GIA contribution, a one-off inflow or
  outflow. They are not the same thing as an Account's own investment
  growth (interest/dividends arising from a GIA or cash balance's return
  assumption, §5.5) — that growth is computed as part of the Account's own
  logic using its growth-rate assumption, not re-entered as a separate
  Income Source, to avoid double-modelling the same return.

Concrete catalog (v1) — this is also the index of what's specified in
detail elsewhere in §3 and §5:

| Type | Kind | Owner | Tax category / treatment | Detailed in |
|---|---|---|---|---|
| Salary | Source | Person | `earnedIncome` | §3.2 |
| State Pension | Source | Person | `statePensionIncome` | §3.3 |
| **Target drawdown income** (composite — see note below) | Source | Person, or `Joint`/combined household | mixed: solved each year across `taxFree` and `pensionIncome`/`capitalGain` (§5.7) | §5.7 |
| Rental income | Source | Person or Joint (linked to a rental `Property`) | `rentalProfit` | §3.8, §5.6 |
| One-off cash inflow | Source | Person or Joint | set per event category (§3.9) — e.g. inheritance is typically `taxFree`, a redundancy payment above £30,000 is `earnedIncome` | §3.9 |
| Property sale proceeds | Source (system-generated) | Person or Joint | `taxFree` (main residence, PRR) or net of `capitalGain` (rental/second property) | §3.8, §5.6 |
| Pension contribution | Drain | Person (funds a `PensionAccount`) | one of the three §5.4 mechanics | §3.4 |
| ISA / GIA / cash contribution | Drain | Person or Joint | `none` (funded from already-taxed income) | §3.5–§3.7 |
| Mortgage payment | Drain | Joint (or Person, if solely owned) | `none` (but the interest portion feeds `rentalProfit`'s tax-credit calculation if the linked property is a rental, §5.6) | §3.8 |
| Living expenses (optional; a flat or age-varying annual figure) | Drain | Person or Joint | `none` | §5.1 |
| One-off cash outflow | Drain | Person or Joint | `none` (unless the event category implies otherwise) | §3.9 |

**Note on the composite type**: unlike every other row, which returns a
single `{amount, taxCategory}` pair, `TargetDrawdownIncome`'s
`calculateForYear` (§9.4) returns a **breakdown** — how much it drew from
each bucket that year (ISA, pension tax-free cash, taxable pension income,
GIA return-of-capital, GIA realised gain, cash) and the tax cost of each —
because the whole point of this type is to decide *where the money comes
from*, not just report a fixed amount (§5.7). It is the one catalog type
whose interface differs from the rest, and is unit tested accordingly:
given a household/person state and a target amount, assert the specific
bucket amounts chosen, not just the total.

### 3.12 Input validation policy

Every input — Household/Person core fields (§3.1–§3.3) and every catalog
type's fields (§3.11) alike — falls into exactly one of two tiers, never
left undeclared:

- **Hard block**: the value is structurally meaningless, not just
  financially unusual, and the UI must prevent saving/proceeding until
  it's corrected (an inline error at the field, no silent coercion or
  clamping). Examples: a negative amount where negative has no meaning
  (a contribution, a balance, an age); a retirement age or
  `TargetDrawdownIncome` start age before the person's current age; an
  end date/age before its own start date/age; a date of birth implying a
  future birth or an unrealistic age (e.g. 130+); a `TargetDrawdownIncome`
  whose owner has zero Accounts or other Income Sources available to draw
  from at its start date.
- **Soft warning**: the value is unusual but not invalid — the UK tax
  system, the market, or the user's own stated intent could genuinely
  produce it — so the projection still runs, with a clearly visible,
  non-blocking flag rather than a dialog the user must dismiss. Examples
  already specified elsewhere: an ISA contribution exceeding the annual
  subscription limit (§5.5), a pension contribution exceeding the
  available Annual Allowance (§5.4, §7's "key flags"). Additional cases
  following the same pattern: a growth-rate assumption outside a sane
  range (e.g. above 20% or a large negative real return — flag it, since
  a user deliberately stress-testing an extreme scenario is a legitimate
  use case, just an unusual one worth confirming wasn't a typo); a
  mortgage term extending past State Pension age; a chosen pension access
  age below the Normal Minimum Pension Age (§6.1).

**Where this is declared**: each catalog type's input schema (§3.11,
§9.4) carries its own validation rules — required fields, min/max, which
tier a given problem falls into — as part of that type's module
definition, the same place its `taxCategory`/`taxTreatment` is declared.
There is no untagged/default validation behaviour, for the same reason
§3.11 requires an explicit tax category: an unvalidated field is where a
user's typo silently becomes a materially wrong projection. Validation
rules ship and are unit tested (§9.3, §12) alongside the rest of each
type's module, not maintained separately in the UI layer where they can
drift out of sync with what the calculation functions actually assume.

---

## 4. Core User Journeys

1. **Onboarding**: a first-time visit (no Scenario in local storage, §9.2)
   opens straight into: choose single-person or two-person household
   (§3.1), enter each person's core details (§3.2) and any
   accounts/properties they hold (§3.4–§3.8), then build up their cash
   flows by adding Income Sources and Income Drains one at a time from the
   catalog (§3.11) — e.g. "+ Add income source → Salary", "+ Add drain →
   Mortgage payment" — rather than filling in one long fixed form.
   Sensible defaults pre-filled for assumptions (inflation, growth rates)
   that the user can override. A **returning visit** (a Scenario already
   saved locally) skips straight to the dashboard (journey 2) with
   everything exactly as last left, and offers "Open a saved file" as an
   alternative entry point for a user arriving with an exported file
   (§9.2) instead — e.g. on a different device, or a fresh browser
   profile.
2. **Dashboard**: single-page summary — projected net worth over time
   (chart), projected retirement income vs target, a breakdown by account
   type, and key flags (e.g. "on track", "pension contributions exceed
   Annual Allowance in 2031"). For a two-person household, shown at
   household level by default (combined net worth, combined income vs
   combined target) with a toggle to split any chart by person — both
   views matter: household totals for "are we on track", per-person for
   "whose pension/ISA is this coming from".
3. **Year-by-year detail**: a table/drill-down showing, for any selected
   year: gross income, tax paid (by type), net income, contributions made,
   account balances, and cash surplus/deficit — for a household, broken
   down per person (since tax is calculated per person) with a household
   total row.
4. **Scenario comparison**: duplicate the current plan as a new scenario,
   change one or more inputs (e.g. retire 2 years earlier, increase pension
   contribution by 3%, transfer Marriage Allowance), and compare projected
   outcomes side by side.
5. **Tax breakdown view**: for any given year, show exactly how tax was
   calculated (Income Tax by band, NI, dividend tax, CGT, pension relief
   received) — transparency is a core trust requirement for this product.
   For a household, show each person's breakdown plus, where relevant, the
   cross-person mechanic that affected it (e.g. "Marriage Allowance
   transferred £1,260 of Person A's Personal Allowance to Person B").
6. **Drawdown sourcing view**: for the decumulation phase (§5.7), two
   linked views built directly off `TargetDrawdownIncome`'s bucket
   breakdown (§3.11), for a single person or, for a household, per person
   plus a combined total:
   - **Table**: one row per tax year, one column per bucket (e.g.
     Personal-Allowance pension income, ISA, pension tax-free cash, cash,
     GIA return-of-capital, Basic/Higher/Additional Rate pension income,
     GIA realised gain) showing the £ drawn from each that year, plus a
     total and the tax cost — so the user can see exactly which pound
     came from where, for any year.
   - **Graph**: each bucket's *remaining balance* plotted over the whole
     plan (stacked area or multi-line), so the user can see how each
     bucket is depleted (or not) through time — e.g. spotting that the
     ISA runs out at age 78 and taxable pension drawdown increases to
     compensate from that point.
   For a two-person household, additionally let the user compare the
   solver's chosen per-person split against an even/naive split — this is
   the single highest-value "what if" for a couple, since UK tax is
   individual and splitting withdrawals well between two people's
   allowances can materially reduce lifetime tax (§5.7.4).
7. **Save, export & reopen** (§9.2): every edit auto-saves locally with no
   explicit action needed, so simply closing the tab and coming back is
   the default "save" journey. Alongside that, two explicit actions: (a)
   **"Save to file"** — download the Scenario's inputs as a portable
   `.json` file, prompted periodically after significant edits as well as
   available on demand, since it's the only thing that survives clearing
   browser data or moving devices (§9.2, §11); (b) **"Export report"** —
   download the full year-by-year projection as CSV/PDF, per person and
   combined, including the drawdown sourcing table — this is a read-only
   report for sharing or printing, distinct from the "Save to file"
   input-data file that can be re-opened and edited later.

---

## 5. Projection Engine — Methodology

### 5.1 Simulation model
Deterministic, year-by-year (tax-year-aligned) simulation from the current
date to the end age, run entirely in **real (today's-money) terms** —
every rate used below has already been converted from the user's nominal
input to a real rate before the simulation starts (§5.8). For a two-person
household, **each person's Income Tax, NI, dividend tax, and CGT are
computed independently** (the UK has no concept of joint taxation for
these), while cash allocation, the mortgage, and account growth are
handled at whichever level (person or household) the account is owned at
(§3.1, §8). Each simulated year:

1. Evaluate every active Income Source and Income Drain for that year
   (§3.11, §9.4) via its `calculateForYear`, using its already-real growth
   rate — inflation-linked items need no separate uprating step; only
   items marked fixed in nominal cash terms (e.g. a fixed-rate mortgage
   payment, §3.8, §5.8) are deflated downward this year as part of that
   evaluation. This step is generic — the loop never names "salary" or
   "mortgage" specifically; it just runs whatever's active, which is why
   a new catalog type never requires touching this loop (§9.4).
2. For each person independently, sum their active Income Sources into
   gross income for the year, grouped by `taxCategory` (§3.11) — salary,
   their share of rental profit, their share of taxable GIA/cash income,
   pension income if in drawdown, State Pension if in payment, and so on
   are all just Income Sources evaluated in step 1, not special-cased here.
3. Apply each person's active pension-contribution Income Drains and their
   declared relief mechanic (§5.4) — this can reduce taxable income before
   Income Tax is computed (relief-at-source vs net pay/salary sacrifice
   differ here, see below). A person can simultaneously have an active
   Salary Income Source, a `TargetDrawdownIncome` Income Source, and a
   capped pension-contribution Income Drain in the same year — phased/
   partial retirement (still working, already drawing a pension) is not a
   special mode, just three ordinary catalog items with overlapping active
   date ranges; the MPAA cap (§5.4) exists precisely for this case.
4. Apply Marriage Allowance transfer between the two people, if elected
   and eligible (§5.2), before computing final Income Tax.
5. Compute Income Tax, NI, dividend tax, and CGT for the year, per person,
   using that year's tax table (§6, English rates only, §1.2).
6. Sum each person's/household's remaining active Income Drains (mortgage
   payment, living expenses, one-off outflows, and so on — again, no drain
   type is named specially here) to get net spendable household cash for
   the year: combined net income minus these drains.
7. Allocate remaining surplus cash to savings/investment per the user's
   contribution Income Drains, split across each person's own accounts
   (ISA/pension/GIA) and any joint accounts; any surplus left unallocated
   is swept into that person's (or the household's) `CashAccount` rather
   than left untracked, so it stays visible in net worth and starts
   accruing (taxable) interest like any other cash balance.
8. Grow all account balances by their assumed growth rate, net of charges.
9. For each person with an active `TargetDrawdownIncome` Income Source
   that year (§5.7.1 — its start date having been reached is what actually
   puts a person "in decumulation," not a separate hard-coded retirement-
   age flag), run the drawdown solver (§5.7) to source that year's target
   from their available buckets, still subject to that person's own tax
   position and jointly optimised across the household if a combined
   target is set (§5.7.4).
10. Record the full year's ledger, per person and combined (for the
    year-by-year detail view), and move to the next year.

This is intentionally a **cash-flow ledger simulation**, not just a
compound-interest formula, because tax and allowances depend on the
interaction between multiple income sources within a single tax year —
and for a household, on the interaction between two people's independent
tax positions plus the small number of mechanics that legitimately bridge
them (Marriage Allowance, joint account income splitting, interspousal
transfers).

### 5.2 Income Tax
- Apply the Personal Allowance, then the Basic/Higher/Additional rate
  bands (English rates only, §1.2, §6) to total taxable income (employment
  + pension income in payment + State Pension + taxable savings/dividend
  income after their own allowances). Both sides of this comparison are in
  real terms (§5.8): income is already a real figure from step 3 of the
  simulation loop (§5.1), and the thresholds are the year's real (deflated
  or held-flat, per the uprating assumption, §3.10) values — the engine
  never needs to convert either side back to nominal to compare them.
- Apply Personal Allowance tapering: reduced by £1 for every £2 of
  "adjusted net income" over the taper threshold, down to £0 — this is why
  pension contributions (which reduce adjusted net income) can be
  particularly valuable for income just above the taper threshold; the
  engine must recompute this interaction, not treat tax bands as static.
- State Pension is taxable income but is paid gross (no tax deducted at
  source) — it still consumes Personal Allowance / band space alongside
  other income.
- **Marriage Allowance** (married/civil partnership households only,
  §3.1): a person who doesn't use their full Personal Allowance can elect
  to transfer a fixed 10% of it (rounded, set by the tax table, §6.1) to
  their spouse/civil partner, provided the receiving person is a basic-rate
  taxpayer. This directly reduces the receiving person's tax and is one of
  the few places the engine computes one person's Income Tax using a
  number derived from the other person's position — model it as an
  explicit, user-toggleable election per year (not always optimal to
  claim, e.g. it can be irrelevant if both are already using their full
  allowance) rather than auto-applying it.

### 5.3 National Insurance
- Apply Class 1 employee NI to salary between the Primary Threshold and
  Upper Earnings Limit, and a lower rate above the UEL.
- NI stops accruing at State Pension age even if still employed — model
  this transition.
- Salary sacrifice pension contributions reduce NI-able pay (this is the
  main quantitative advantage of salary sacrifice over relief-at-source —
  the engine must model it as an actual NI saving, not just an Income Tax
  one).

### 5.4 Pension contributions and tax relief
Three mechanisms, each with different mechanics — the engine must support
all three per pension account:
- **Relief-at-source**: employee pays from net pay; provider adds basic-rate
  relief; higher/additional-rate relief reclaimed by extending the
  basic/higher-rate band boundary by the gross contribution (this is what
  reduces higher-rate tax liability elsewhere in the calculation — a
  cross-cutting effect, not a simple deduction).
- **Net pay arrangement**: contribution deducted from gross salary before
  Income Tax is calculated (full relief automatically at marginal rate);
  no effect on NI.
- **Salary sacrifice**: contribution deducted from gross salary before both
  Income Tax and NI are calculated (relief at marginal rate on both).

Also model:
- **Annual Allowance**: standard AA per year, tapered for high earners —
  the taper applies only when **both** "threshold income" exceeds
  `taperThresholdIncome` (§6.1) **and** "adjusted income" exceeds
  `taperThresholdAdjustedIncome` (§6.1); when both conditions are met, the
  AA reduces by £1 for every £2 of adjusted income above that threshold,
  down to `taperMinimumAllowance`. Contributions above the available AA
  (including unused allowance carried forward from the previous 3 tax
  years) trigger an Annual Allowance tax charge, added back as a tax
  liability.
  - **This spec uses three similarly-named but genuinely different HMRC
    income tests, and they must not be conflated**: "adjusted net income"
    (§5.2) gates the *Personal Allowance* taper; "threshold income" and
    "adjusted income" (both here) gate the *Annual Allowance* taper. Each
    has its own precise statutory definition (broadly: threshold income
    is net income before pension contributions, with certain reliefs
    added back; adjusted income is threshold income plus the individual's
    own pension contributions and any employer contributions) that this
    spec doesn't spell out formula-by-formula — that level of detail
    belongs in the implementation, sourced directly from HMRC's own
    definitions (§6.1's sourcing approach) rather than restated here, but
    it must be pinned down as its own small, unit-tested function (§9.3)
    per test, before Phase 2 of the build sequence (§13) implements the
    AA taper — implementing this from the *names* alone is exactly how a
    subtle, high-earner-only bug would slip through undetected until a
    user compares results against their own accountant's numbers.
- **MPAA**: once a pension is flexibly accessed (income drawdown taken),
  future contributions to that person's DC pensions are capped at the
  MPAA — relevant for users who plan partial retirement / phased drawdown
  (§5.1 step 3).
- **Employer contributions** count toward the AA too and are not
  themselves taxed as income.
- **Both the AA's 3-year carry-forward and the Lump Sum Allowance (§5.7.2)
  are cumulative, cross-year, cross-pot totals, not per-year or per-pot
  checks.** This doesn't conflict with §9.3's "small pure functions, no
  shared mutable state" principle — it means the relevant running totals
  (unused AA for each of the previous 3 tax years; LSA used to date) are
  explicit inputs to, and explicit outputs from, each year's calculation,
  threaded forward by the year-by-year loop (§5.1) as part of that
  person's ledger, the same way a bank balance is threaded forward rather
  than recomputed from scratch each year. The functions themselves stay
  pure (same inputs always produce the same outputs); what's pure isn't
  the same as what's stateless across years.

### 5.5 ISA and GIA taxation
- ISA growth, income, and withdrawals: entirely tax-free, no reporting.
  Enforce the annual ISA subscription limit across all ISA types combined
  (validation warning, not a hard block, since real-world overpayment is a
  user error the tool should flag).
- GIA: interest income taxed via the Personal Savings Allowance (amount
  varies by the account holder's Income Tax band) then at savings rates;
  dividend income taxed via the separate Dividend Allowance then at
  dividend rates (basic/higher/additional); realised capital gains taxed
  via the CGT Annual Exempt Amount then at CGT rates — the engine needs a
  simple assumption for what fraction of GIA growth is realised each year
  vs unrealised (default: realise gains only on withdrawal, i.e.
  buy-and-hold, unless the user models regular rebalancing).
- **Joint GIA/cash accounts** (household only): income and gains split
  50/50 between the two people by default (married/civil partnership
  assumption), or per a user-specified ownership split for unmarried
  co-owners (§3.6–3.7); each half is then taxed entirely within that
  person's own allowances and bands.
- **Interspousal transfers** (married/civil partnership households only):
  assets can be transferred between spouses/civil partners at no CGT
  cost. This means a household can, in principle, realise gains using
  both people's CGT Annual Exempt Amount and rate bands rather than just
  one — model this as an optional planning lever (e.g. "rebalance GIA
  ownership before a large disposal") rather than an automatic behaviour,
  since it requires a deliberate action in real life.

### 5.6 Property income and Capital Gains Tax
- **Rental income**: gross rental income minus allowable letting expenses
  (management/agent fees, maintenance, insurance, ground rent/service
  charge — but not mortgage capital repayments) gives rental profit,
  taxed as income at the owning person's marginal Income Tax rate,
  alongside their salary/other income — there's no separate "property tax
  rate". A small **Property Income Allowance** (fixed amount per tax year,
  in the tax table §6.1) can be deducted instead of actual expenses if
  simpler/larger; the engine should compute both and use whichever is
  more favourable, as a landlord legitimately would.
- **Mortgage interest relief restriction**: mortgage *interest* on a
  rental property is **not** deducted from rental income before tax (the
  pre-2020 rules that allowed this no longer apply); instead, the
  landlord gets a flat-rate tax credit — currently the interest amount ×
  the basic rate of Income Tax — applied after rental profit is taxed at
  their marginal rate. This is a common source of "why is my rental
  income tax so high" confusion for higher/additional-rate taxpayers, and
  is exactly the kind of interaction this tool should surface explicitly
  in the tax breakdown view (§4, journey 5) rather than silently netting
  it off.
- **Sale of a rental/second property**: any gain (sale price minus
  purchase price minus qualifying costs, e.g. purchase/sale legal and
  agent fees and qualifying capital improvements) is subject to CGT at
  the **residential property rates** after the person's CGT Annual Exempt
  Amount, and split per ownership share for a jointly-owned property.
  These happen to equal the general CGT rates used for GIA disposals for
  2026/27 (§6.1) — both were aligned at 18%/24% from the October 2024
  Budget onward — but the tax table keeps them as separate fields (§6.1's
  `capitalGainsTax` vs `property.cgtResidential*`) because they have
  historically diverged (residential property carried higher rates before
  October 2024) and could again; never assume the engine can collapse them
  into one field just because this year's values match. UK
  CGT on residential property must be reported and paid within a fixed
  window after completion (currently 60 days) rather than waiting for the
  normal Self Assessment deadline — the engine should reflect this as a
  near-immediate cash outflow in the sale year rather than the following
  tax year, since that timing materially affects the household's
  available cash straight after a sale.
- **Sale of a main residence**: fully exempt from CGT under **Private
  Residence Relief**, provided it has been the person's (or household's)
  only/main residence throughout the period of ownership — the default
  and common case. The engine should still surface the PRR assumption in
  the tax breakdown view so the user can see *why* no CGT was charged,
  and flag it as a simplification if the property wasn't the main
  residence for the whole ownership period (e.g. a former home now let
  out) rather than silently applying full relief in that case.
- Net sale proceeds (price − selling costs − any CGT due − any
  outstanding mortgage redeemed, §3.8) are added to the owning person's
  (or household's, if jointly owned) cash/GIA balance as a one-off event
  in the sale year, and that property's ongoing rental income/mortgage
  cash flows stop from that point.

### 5.7 Retirement / decumulation phase

- From the user's chosen pension access age (minimum age set by the
  current Normal Minimum Pension Age) onward, pensions can be drawn.
- State Pension begins at State Pension age (computed from date of birth
  per the relevant SPA timetable) and adds to taxable income from that
  point, automatically, once claimed — it's not a discretionary draw
  (below).

#### 5.7.1 How the user expresses a target
The user does not manually specify an amount per account per year. They
enter one number: **how much net income they want that year** (in today's
money, §5.8) — captured as a `TargetDrawdownIncome` Income Source (§3.11),
scoped either to one person or combined across the household (§3.1), with
a start age (defaulting to that person's retirement age) and, optionally,
an end age or step-change (e.g. "£30k until State Pension age, then
£24k"). The engine is responsible for working out **where that money comes
from** — this is the calculation described below, and it is exactly the
kind of self-contained, independently testable unit §9.3–§9.4 describe: given
a target amount and the current state of every account, it returns a
breakdown of how much was drawn from each bucket and at what tax cost,
rather than a single scalar amount.

#### 5.7.2 The two buckets
Every year in decumulation, before the solver runs, the engine first
totals up **automatic income** that arrives regardless of any drawdown
decision: State Pension (once claimed), net rental profit (§5.6), and any
GIA/cash interest or dividends earned that year (taxed as accrued whether
withdrawn or not, §5.5). If automatic income already meets or exceeds the
target, no discretionary drawdown is needed that year. Otherwise the
solver must source the **shortfall** from two discretionary buckets:

- **Tax-free bucket** — withdrawing from these has no tax consequence at
  all, regardless of amount: ISA balances (any type), the tax-free portion
  of any pension withdrawal (up to 25%/the Lump Sum Allowance, §5.4 — see
  below for exactly when this becomes available), cash savings principal,
  and the return-of-capital portion of a GIA withdrawal (the original cost
  basis, as opposed to any gain — §3.6, §5.5).
- **Taxable bucket** — each pound drawn is taxed at the drawing person's
  marginal rate for that income type: taxable pension income and the
  realised-gain portion of a GIA withdrawal (subject to CGT, §5.5).

**How pension tax-free cash actually becomes available**: the default
model is **UFPLS-style** — each pound the solver draws from a still-
uncrystallised pension pot is automatically split 25% tax-free / 75%
taxable at the point of withdrawal (not as a separate upfront decision),
until that pot's share of the person's Lump Sum Allowance is used up,
after which further withdrawals from it are 100% taxable. This needs no
separate "crystallisation event" concept and fits the bucket model
directly: a single pension withdrawal simultaneously contributes to both
buckets in a fixed 25/75 proportion. A pot marked "crystallise fully at
retirement" (§3.4's override) behaves differently: at that pot's
`TargetDrawdownIncome` start date, 25% of it (up to remaining LSA
headroom) is moved into the tax-free bucket as an immediate lump sum —
functionally a system-generated one-off transfer, the same mechanism as a
property sale (§3.8) — and the remaining 75% becomes an ordinary
crystallised drawdown pot, drawn thereafter as 100% taxable income with no
further tax-free proportion. Either way, the Lump Sum Allowance is tracked
as a running total **per person, across every pension pot, for the whole
plan** (§5.4) — it never resets and is never assessed pot-by-pot in
isolation.

#### 5.7.3 The solver
Pure "tax-free first" is **not** optimal, because unused Personal
Allowance is also effectively free — taxable pension income drawn within
a person's remaining Personal Allowance costs 0% tax, exactly like the
tax-free bucket, but *without* permanently spending down a wrapper (ISA)
that would otherwise keep compounding tax-free for the rest of the plan.
The default solver therefore fills the shortfall in ascending order of
marginal cost, per person, each year:

1. Taxable-bucket withdrawals within the person's remaining Personal
   Allowance for the year (0% — "free" income that doesn't touch the ISA).
2. Tax-free bucket withdrawals (ISA, pension tax-free cash, cash
   principal, GIA return-of-capital) — 0% cost, capped by each bucket's
   available balance.
3. Taxable-bucket withdrawals within the person's Basic Rate band and, for
   a GIA gain, within their CGT Annual Exempt Amount — comparing the two
   effective marginal rates (Income Tax on pension income vs CGT on a
   realised gain) and preferring whichever is cheaper for the next £
   needed.
4. Escalating further into Higher/Additional Rate taxable withdrawals only
   once buckets 1–3 are exhausted.

This ordering is the **default strategy**, not a hard rule — expose it as
an editable priority for a user who wants to override it (e.g.
deliberately preserving ISA headroom for a large known future expense).
Whichever strategy is active, the engine always reports the resulting tax
cost so the effect of a manual override is visible, not hidden (§4,
journey 5).

#### 5.7.4 Household drawdown optimisation
For a two-person household with a combined target (§3.1), the solver
above runs **per person**, but *which* person draws *which* bucket first
is itself part of the optimisation — because Personal Allowance, Basic
Rate band headroom, and the Personal Savings/Dividend/CGT allowances are
all per-person, a given household net income can be delivered at very
different total tax costs depending on the split (e.g. drawing more from
the lower-earning/non-earning person's pension to use their otherwise-
wasted Personal Allowance, before touching the higher earner's taxable
income). Provide this as the default behaviour when a combined household
target is set, alongside simpler "even split" or "user-specified split"
alternatives — always showing the tax difference against those
alternatives, since the point is to make that saving visible and
explicable (§4, journey 6), not to hide a black-box result.

#### 5.7.5 Survivorship
If one person's projection reaches their end age (§3.2) before the
other's, the plan continues for the surviving person alone — their own
accounts continue as normal, and (v1 simplification) any of the deceased
person's ISA/GIA/cash balances the surviving person is assumed to inherit
should be flagged as a modelling assumption to confirm, since actual
treatment depends on the will/estate and, for pensions, the scheme's
death-benefit rules (nomination, age at death, and — from April 2027 —
inheritance tax on pensions, out of scope per §11).

### 5.8 Inflation and "real" vs "nominal" figures

**The engine simulates in real (present-day/today's-money) terms
throughout, and by default every figure shown to the user — balances,
income, tax, thresholds — is in today's £.** This is a deliberate reversal
of the more obvious "simulate in nominal £, deflate for display" design,
for two reasons: (1) it's what users actually want to reason about — "will
I have enough to live on, in terms I understand today" — a headline figure
of "£2.3m at age 68" is close to meaningless without mentally deflating it
first, and users shouldn't have to; (2) it removes a whole class of
unnecessary calculation, because once every rate has been converted to a
real rate at the point of input (§3.10), holding a value "flat" across the
simulation *is* the inflation-linked case — there is nothing further to
compute.

Mechanically:
- Every growth/return rate (investment growth, salary growth, rental
  growth, property price growth) is converted from the user's nominal
  input to a real rate at the point of input (§3.10), once, using that
  year's inflation assumption. The year-by-year simulation (§5.1) then
  grows every balance and every income stream using these already-real
  rates — it never re-introduces inflation.
- Tax thresholds/allowances/rates (§6) for the current and any already-
  confirmed future tax years are published as nominal cash figures and are
  deflated to today's terms once, on load, the same way. Beyond the latest
  confirmed tax year, thresholds are projected forward per the user's
  uprating assumption (§3.10): "inflation-linked" needs no further
  calculation (the real value is simply held constant); "frozen in cash
  terms" or a "custom annual %" require the threshold's real value to be
  recomputed each year, since those are the cases where a nominally-fixed
  or below-inflation-uprated figure genuinely loses real value over time.
- Some cash flows are **genuinely fixed in nominal terms** and must be
  modelled that way even in an otherwise real-terms engine, because their
  real value is *supposed* to erode — most notably a fixed-rate mortgage
  payment (§3.8), which stays the same number of actual future pounds for
  the length of the fixed deal and so must be deflated year-by-year in the
  simulation (its real cost falls every year), not held flat like an
  inflation-linked item. The engine must support both "flat in real terms"
  and "flat in nominal terms, declining in real terms" as distinct
  behaviours per cash flow, and default each cash-flow type sensibly
  (salary/investment growth/tax thresholds/State Pension → inflation-
  linked by default; mortgage payments, and any other cash flow the user
  marks as a fixed nominal amount → nominal-flat).
- Since everything is already real, there is no separate "deflate for
  display" step — that used to be the point of a toggle. Instead, provide
  an (off-by-default, clearly labelled) toggle to see the **nominal**
  projection — the actual future £ amounts, inflated back up using the
  same inflation assumption — for anyone who specifically wants to know
  "what will the cash number in my account actually say," e.g. to compare
  against a bank statement or a pension provider's own nominal-terms
  projection.
- This whole approach rests on one **flat, constant inflation assumption**
  applied uniformly across the projection (§3.10) — it does not model
  varying inflation year to year, and confirmed nominal tax thresholds for
  near-term tax years are deflated using this same flat assumption rather
  than actual historical CPI between now and that tax year, which can
  introduce a small discrepancy for the first year or two of a plan
  (flagged as a known simplification, §11).

---

## 6. Tax Rules Data Model

### 6.1 Principle
All tax rates, bands, and allowances are **data, not code** — stored as a
set of dated "tax year rule sets" that the calculation engine looks up by
tax year. This is the mechanism that satisfies the "configurable tax-year
tables" requirement: adding a new tax year is a data change (ideally
editable by a non-engineer, e.g. via an admin UI or a reviewed config
file/PR), not a code deployment.

Shape, populated with the **2026/27 tax year** (6 April 2026 – 5 April
2027) figures as published on gov.uk — sources listed after the example,
subject to the re-verification caveat in §0:

```json
{
  "taxYear": "2026-27",
  "incomeTax": {
    "personalAllowance": 12570,
    "personalAllowanceTaperThreshold": 100000,
    "personalAllowanceTaperRate": 0.5,
    "bands": [
      { "name": "basic", "upTo": 50270, "rate": 0.20 },
      { "name": "higher", "upTo": 125140, "rate": 0.40 },
      { "name": "additional", "upTo": null, "rate": 0.45 }
    ],
    "marriageAllowance": { "transferableAmount": 1260, "requiresBasicRateRecipient": true }
  },
  "nationalInsurance": {
    "primaryThreshold": 12570,
    "upperEarningsLimit": 50270,
    "mainRate": 0.08,
    "upperRate": 0.02
  },
  "dividendTax": {
    "allowance": 500,
    "basicRate": 0.1075,
    "higherRate": 0.3575,
    "additionalRate": 0.3935
  },
  "capitalGainsTax": {
    "annualExemptAmount": 3000,
    "basicRate": 0.18,
    "higherRate": 0.24
  },
  "isa": { "annualSubscriptionLimit": 20000, "lisaAnnualLimit": 4000, "lisaBonusRate": 0.25 },
  "property": {
    "incomeAllowance": 1000,
    "mortgageInterestReliefRate": 0.20,
    "cgtResidentialBasicRate": 0.18,
    "cgtResidentialHigherRate": 0.24,
    "cgtReportingDeadlineDays": 60
  },
  "pensions": {
    "annualAllowance": 60000,
    "moneyPurchaseAnnualAllowance": 10000,
    "taperThresholdIncome": 200000,
    "taperThresholdAdjustedIncome": 260000,
    "taperMinimumAllowance": 10000,
    "lumpSumAllowance": 268275,
    "lumpSumAndDeathBenefitAllowance": 1073100,
    "normalMinimumPensionAge": 55
  },
  "statePension": {
    "fullWeeklyAmount": 241.30,
    "qualifyingYearsForFull": 35,
    "qualifyingYearsMinimum": 10
  },
  "savingsAllowance": {
    "basicRatePayer": 1000,
    "higherRatePayer": 500,
    "additionalRatePayer": 0
  }
}
```

**Sources** (fetched from gov.uk for 2026/27; each rule set should carry
its own source list like this per §6.2's auditability requirement):
- [Income Tax rates and Personal Allowance](https://www.gov.uk/income-tax-rates)
- [National Insurance rates and thresholds for employers 2026 to 2027](https://www.gov.uk/guidance/rates-and-thresholds-for-employers-2026-to-2027)
- [Tax on dividends](https://www.gov.uk/tax-on-dividends)
- [Capital Gains Tax rates](https://www.gov.uk/capital-gains-tax/rates)
- [Tax-free interest on savings (Personal Savings Allowance)](https://www.gov.uk/apply-tax-free-interest-on-savings)
- [Individual Savings Accounts (ISA)](https://www.gov.uk/individual-savings-accounts)
- [Lifetime ISA](https://www.gov.uk/lifetime-isa)
- [Pension Annual Allowance](https://www.gov.uk/tax-on-your-private-pension/annual-allowance)
- [Pension Lump Sum Allowance](https://www.gov.uk/tax-on-your-private-pension/lump-sum-allowance)
- [New State Pension — what you'll get](https://www.gov.uk/new-state-pension/what-youll-get)
- [Renting out a property — paying tax](https://www.gov.uk/renting-out-a-property/paying-tax)
- [Tax relief for residential landlords — how it's worked out](https://www.gov.uk/guidance/changes-to-tax-relief-for-residential-landlords-how-its-worked-out-including-case-studies)
- [Marriage Allowance](https://www.gov.uk/marriage-allowance)
- [Report and pay Capital Gains Tax on UK property](https://www.gov.uk/report-and-pay-your-capital-gains-tax/if-you-sold-a-property-in-the-uk-on-or-after-6-april-2020)

Two figures above were **not** directly stated on the pages fetched and
should get extra scrutiny at verification time: `taperThresholdIncome`
(200000) — the "threshold income" condition that must *also* be exceeded
alongside adjusted income for the Annual Allowance taper to apply (§5.4)
— and `taperMinimumAllowance` (10000) — the floor the tapered Annual
Allowance cannot go below. Both are well-established, stable figures
(unchanged for several tax years) but were filled from general knowledge
rather than quoted directly from a fetched page.

The Normal Minimum Pension Age (55) is confirmed current for 2026/27 but
is legislated to rise to 57 from 6 April 2028 — the same kind of
known-future rule change already flagged for pension IHT (§11), worth
tracking for whenever the tax-year rule set reaches 2028/29.

### 6.2 Governance
- Each rule set has an effective date range and a source reference (link to
  the relevant gov.uk/HMRC page) for auditability.
- New tax years are typically confirmed at the Spring Budget/Statement
  ahead of the 6 April start — provide a workflow to add next year's rule
  set as soon as it's announced, with the previous year's rules remaining
  available for anyone whose projection starts before 6 April.
- The **latest confirmed rule set** is also the boundary the engine uses
  for real-terms projection (§5.8): every tax year up to and including it
  uses its own published nominal figures (deflated to today's terms);
  every year beyond it is projected using the user's uprating assumption
  (§3.10) applied to that last confirmed rule set's real values.
- Golden-file tests (§12) pin known correct tax calculations for each
  published rule set, so a rule-set edit that breaks a known-correct
  scenario fails CI before it reaches users.

---

## 7. Outputs

All figures below are in **today's money (real terms) by default** — the
engine's native unit, per §5.8 — with a clearly labelled, off-by-default
toggle to switch any view to nominal (actual future £) terms.

- **Net worth over time**: stacked area/line chart by account type (pension,
  ISA, GIA, cash, property equity net of mortgage).
- **Retirement income projection**: annual net income from State Pension +
  pension drawdown + rental income (net of tax) + other sources, compared
  against the user's target.
- **Tax paid over time**: chart/table of total tax (Income Tax + NI +
  dividend tax + CGT, including any property-related Income Tax on rental
  profit and CGT on a property sale) by year and by type.
- **Property sale scenario view**: for any property with a planned sale
  (§3.8), show the modelled net proceeds, CGT due (or Private Residence
  Relief applied), and mortgage redemption, alongside the effect of moving
  the sale date earlier/later on total household tax and net worth.
- **Drawdown sourcing table and bucket-balance graph** (§4, journey 6):
  the primary decumulation-phase output — a year-by-bucket table of how
  the `TargetDrawdownIncome` solver (§5.7) sourced each year's target, and
  a graph of each bucket's balance over time so depletion of any one
  bucket (typically the ISA) is visible before it happens, not just after.
- **Year-by-year ledger table**: exportable (CSV/PDF), full detail per §4,
  journey 3.
- **Key flags/warnings**: e.g. Annual Allowance exceeded, ISA limit
  exceeded, MPAA triggered, projected shortfall vs target income, pot
  depleted before end of plan.
- **Scenario comparison view**: side-by-side or overlaid chart for two or
  more named scenarios.

---

## 8. Data Model (core entities)

There is no `User`/account entity — there is no backend to hold one
(§9.1). A `Scenario` doesn't belong to anyone in the data model; it simply
exists in whichever browser's local storage holds it, or in whichever
exported file the user is holding (§9.2). "Person" (below) is the one
identity concept in this model, and it's a financial actor being modelled,
not a login.

- `Scenario` — a named, versioned set of inputs + assumptions; a
  `schemaVersion` field so exported files (§9.2) stay readable across app
  updates. The **local store** (browser IndexedDB) holds an ordered list
  of Scenarios, letting one user keep multiple distinct plans (e.g. "base
  case" and "retire early") without any login — just an in-app switcher.
  Each Scenario has exactly one `Household`.
- `Household` — belongs to a Scenario; holds one or two `Person` records
  plus household-level settings: relationship status (married/civil
  partnership vs unmarried, gates Marriage Allowance and interspousal
  transfer logic, §5.2/§5.5), and whether targets/results are tracked
  combined or per-person (§3.1).
- `Person` — DOB, target retirement age (a UI default only, §3.2 — not
  read by the simulation loop), projection end age. Belongs to a
  Household. Salary, drawdown income targets, and other
  recurring income are **not** Person fields — they're `IncomeSource`
  instances owned by the Person (§3.11, including `TargetDrawdownIncome`,
  whose active date range is what the simulation loop actually checks to
  determine decumulation, §5.1), so a Person can have zero, one,
  or several (e.g. salary now, pension drawdown income later).
- `Account` — polymorphic: `PensionAccount` (workplace/SIPP), `ISAAccount`
  (cash/S&S/LISA), `GIAAccount`, `CashAccount`, `Property`. Every Account
  has an `owner`: a specific `Person`, or `Joint` (household-owned) —
  `PensionAccount` and `ISAAccount` can never be `Joint` (§3.4–3.5), since
  UK law doesn't allow joint ownership of either.
- `Property` — a specialisation of `Account` (§3.8): type (main residence
  or rental), current value + growth rate, purchase price + date (CGT cost
  basis), optional `rentalDetails` (gross rental income, letting expenses)
  when type is rental, optional `plannedSale` (date/age, expected price,
  selling costs), and an optional embedded `Mortgage` (a mortgage is
  always secured against exactly one property in this model, so it's not
  a standalone Account type — outstanding balance, rate, term, repayment
  type, payment, overpayments, as split into interest/capital components
  since rental tax treatment depends on that split, §5.6).
- `IncomeSource` — a cash inflow: `type` (one of the catalog types in
  §3.11 — `Salary`, `StatePension`, `PensionDrawdownIncome`,
  `RentalIncome`, `OneOffInflow`, `PropertySaleProceeds`, …), `owner` (a
  specific `Person`, or `Joint`), a calculation rule for the amount (fixed
  £, % of something, or type-specific), a start/end condition (date, age,
  or "for life"), an optional link to the `Account`/`Property` it draws
  from or feeds, and a **required** `taxCategory` (§3.11) — there is no
  untagged/default case. Every recurring or one-off inflow (salary, State
  Pension, rental income, pension drawdown income, an inheritance) is an
  `IncomeSource` instance of the appropriate type.
- `IncomeDrain` — a cash outflow: `type` (`PensionContribution`,
  `ISAContribution`, `GIAContribution`, `MortgagePayment`,
  `LivingExpenses`, `OneOffOutflow`, …), `owner`, a calculation rule
  (amount/%, start/end date — funding an Account this way replaces a
  separately-named "contribution rule" concept, §3.4), an optional link to
  the `Account`/`Property` it funds or is paid against, and a **required**
  `taxTreatment` (§3.11: `none`, or one of the three §5.4 pension-relief
  mechanics).
- `Assumption` — named override (growth rate, charges) scoped to an
  Account, a Person, or globally to a Scenario; each growth-rate
  Assumption carries whether it was entered as `nominal` or `real` (§3.10,
  §5.8) so the engine knows whether a conversion is needed. A Scenario
  also has exactly one **inflation rate** (§3.10) and one **tax threshold
  uprating assumption** (`inflationLinked` / `frozenNominal` with an
  optional end date / `customRate`, §3.10) — both scenario-level, not
  per-Account, since they're properties of the projection as a whole.
- `TaxYearRuleSet` — versioned tax rule data (§6), not user/Scenario data
  — static reference data bundled with the app build (§9.1), never stored
  per-Scenario or exported with a Scenario file (§9.2); figures are stored
  in nominal terms as HMRC publishes them and deflated to real terms at
  the point a Scenario uses them (§5.8), never pre-converted, so the same
  TaxYearRuleSet can serve Scenarios with different inflation assumptions.
- `ProjectionResult` — the computed output of running a Scenario: a
  per-tax-year ledger **per Person plus a combined household total**
  (income, tax breakdown, contributions, balances, withdrawals) plus
  summary metrics, stored in real terms (the engine's native unit) with
  enough information to regenerate the nominal view on demand (§5.8, §7)
  rather than storing both; derived in-browser and cached locally (e.g. in
  memory or IndexedDB, §9.2), regenerated when the Scenario or the bundled
  TaxYearRuleSet changes — never computed on or persisted to a server.

---

## 9. Architecture

### 9.1 High-level shape

**There is no backend, and no server ever receives, stores, or processes
the user's financial data.** The whole application is a static site (HTML/
CSS/JS deployed to any static host — no server-side rendering, no
application server) that runs entirely in the user's browser:

- **Calculation engine**: a pure, deterministic library (no I/O) that takes
  a Scenario + a sequence of TaxYearRuleSets and returns a ProjectionResult.
  Pure-function design is what makes it testable and auditable (§12), and
  is what makes it possible to run entirely client-side with instant "what
  if" feedback as a user edits an input — there's no network round trip to
  wait on, because there's nothing on the other end of one.
- **Client app**: the static site itself — onboarding, dashboard, scenario
  editor, charts, and the local persistence layer (§9.2) that replaces what
  a backend+database would otherwise do. The calculation engine is a
  package this app imports directly; there is no separate service to call.
- **TaxYearRuleSets**: bundled as static JSON shipped with the site build,
  not served dynamically from anywhere. Adding a new tax year (§6.2) is
  still a pure data change with no calculation-logic touched, but — unlike
  a backend that could hot-update a database — it does require rebuilding
  and redeploying the static site, since that data has nowhere else to
  live. This is a real (if minor) trade-off of the no-backend design,
  worth being explicit about rather than implying tax data updates
  instantly for existing users without a new deploy reaching their browser.
- **Hosting**: any static host (e.g. Netlify, Vercel, GitHub Pages,
  Cloudflare Pages, S3+CloudFront) — no server infrastructure to run,
  patch, or secure, and critically, no backend database of thousands of
  users' financial details to ever be breached, because it doesn't exist.

### 9.2 Local persistence

The user's data must survive closing the tab and coming back later, with
**no server involved at any point**. Two complementary mechanisms:

- **Auto-save to browser storage (primary)**: every change to a Scenario
  is persisted to IndexedDB in the browser, debounced (e.g. a few hundred
  ms after the last edit) so it's cheap and near-instant. Reopening the
  site in the same browser resumes exactly where the user left off with no
  explicit "save" action required — this is what satisfies "continue the
  session later" for the common case. IndexedDB is preferred over
  `localStorage` for this: it's asynchronous (doesn't block the UI thread
  on every keystroke), has a much higher storage ceiling, and handles
  structured data (nested Household/Person/Account/IncomeSource/
  IncomeDrain graphs) without manual JSON stringify/parse of the whole
  blob on every write.
- **Explicit export/import to a file (secondary, but not optional)**:
  a "Save to file" action serialises the current Scenario(s) to a
  downloadable `.json` file (a `schemaVersion` field included for forward
  compatibility as the format evolves) that the user can store wherever
  they choose — their own drive, a personal cloud drive, emailed to
  themselves. An "Open from file" action loads it back in. This exists
  because browser storage alone is fragile and non-portable: clearing
  browsing data, switching browsers, moving to a new machine, or using
  private/incognito mode all silently lose whatever's only in IndexedDB.
  A file the user explicitly holds is the only way this data survives
  those events, and it's also the only way to move a plan to a different
  device, back it up, or hand a copy to a financial adviser — so the UI
  should periodically and unobtrusively prompt an export (e.g. after
  significant edits) rather than leaving it undiscovered as a menu item.
- **What gets exported is inputs, not results**: an exported file contains
  the Scenario/Household/Person/Account/IncomeSource/IncomeDrain/
  Assumption data (§8) — never a frozen `ProjectionResult` — because the
  engine recomputes results instantly and deterministically from inputs
  (§9.1), and because tax rules the app ships with may have moved on
  between export and a later import. Re-importing a file always
  recalculates against whichever TaxYearRuleSets the current version of
  the app has bundled (§6.2), which is the correct behaviour for a "what
  would this look like under current rules" tool, but is a real
  behavioural note worth surfacing in the UI (e.g. "recalculated using the
  current tax year's rules") rather than leaving a user to assume the
  reopened numbers are frozen from when they last saved.
- **Schema-version mismatch on import**: every exported file carries the
  `schemaVersion` it was written with (§8). On import:
  - **Older version than the app supports**: run it through a chain of
    small, one-per-version migration functions (v1→v2, v2→v3, …) up to
    the current schema, the same "small pure function, independently
    unit tested" pattern as everything else (§9.3) — each migration is a
    pure `(oldShape) → newShape` transform with its own fixed-input/
    fixed-output tests, not a single monolithic "load legacy file"
    function that grows unmanageable as versions accumulate.
  - **Same version**: load directly, no transform needed.
  - **Newer version than the app supports** (the app itself is stale —
    realistic given offline/PWA support, §9.8, where a cached old version
    could be opened well after a new one shipped): refuse the import with
    an explicit "this file was created by a newer version of the app —
    refresh to update" message, rather than attempting a lossy partial
    read. Never guess.
  - **Unrecognised/corrupted file**: a clear error, no silent partial
    import — better to fail loudly than to load a Scenario with missing
    or malformed fields the engine then produces subtly wrong numbers
    from.
- **No user accounts**: since there's no backend, there's no login and no
  concept of a server-side "account" — a Scenario belongs to whichever
  browser's local storage holds it, or to whichever file the user is
  holding. Supporting multiple people using the same browser profile, or
  a user wanting to keep several distinct plans, means storing a **list**
  of Scenarios locally (§8) with a simple in-app switcher, not separate
  logins.
- **Residual risk to flag, not solve in v1**: IndexedDB contents sit
  unencrypted on the user's machine by default, readable by anything with
  access to that browser profile. This is an acceptable trade-off for v1
  (the same is true of, say, a spreadsheet saved to the same machine) but
  should be a documented, deliberate decision — not a silent gap — and
  revisited (e.g. an optional local passphrase encrypting the IndexedDB
  payload) if user research says it matters.

### 9.3 Small, discrete, pure functions

The calculation engine (§9.1) must be built as many small, single-purpose,
pure functions — never as a handful of large "compute the whole year"
blocks, and never as a spreadsheet-style chain of cell formulas either,
for the same reason: UK tax calculations are branching and interdependent
within a single year (allowance tapering depends on total income across
multiple sources; NI depends on contribution method; drawdown ordering
depends on account balances) in a way that a rules-engine of small
functions handles cleanly and a formula chain does not. This is not a
style preference; it's the concrete mechanism that makes the engine unit
testable at all, given how much of this spec's correctness lives in
narrow, easy-to-get-wrong rules (§5). Every distinct
tax mechanic gets its own function, with explicit inputs and an explicit
return value — no reaching into a shared mutable Scenario/Household object
and no hidden side effects — so it can be tested with a handful of numbers
in and a handful of numbers out, without constructing a full Scenario,
Household, or running the year-by-year loop (§5.1). Pure doesn't mean
stateless across years, though — a few mechanics (Annual Allowance
carry-forward, the lifetime Lump Sum Allowance, §5.4) are cumulative
across multiple years by nature; there, the running total is simply an
explicit input and output of the function, not a hidden mutation, so the
function stays just as pure and just as testable with fixed numbers in
and out. For example (not an exhaustive list — the same principle applies
throughout §5):

- `applyIncomeTaxBands(taxableIncome, bands) → tax` and
  `taperPersonalAllowance(adjustedNetIncome, allowance, threshold) →
  reducedAllowance` (§5.2) as two separate functions, not one, since they
  vary independently and each has its own edge cases worth testing on
  their own (a band boundary; a taper reaching exactly £0).
- `calculateNI(pay, thresholds) → ni` (§5.3), independent of Income Tax
  entirely, reflecting that they're genuinely separate calculations in UK
  tax law.
- One function per pension relief mechanism (§5.4) —
  `applyReliefAtSource`, `applyNetPayRelief`, `applySalarySacrificeRelief`
  — rather than one function with a method-switch inside it, so each
  mechanism's NI/tax interaction is independently provable.
- `calculateRentalProfitTax(rentalProfit, marginalRate)` and
  `calculateMortgageInterestCredit(interestPaid, basicRate)` (§5.6) as two
  functions, mirroring the fact that these are two separate steps in real
  landlord tax, not one blended calculation.
- `calculateCGT(gain, annualExemptAmount, rates)` and
  `applyPrivateResidenceRelief(gain, qualifyingPeriod, ownershipPeriod)`
  (§5.5, §5.6) kept apart, since PRR either zeroes the gain or it doesn't,
  ahead of any rate calculation.
- `convertNominalToReal(nominalRate, inflationRate) → realRate` and
  `uprateThreshold(thresholdValue, policy, yearsElapsed) → upratedValue`
  (§5.8) as small, easily golden-tested pure functions, since the exact
  Fisher-equation math and the three uprating policies are exactly the
  kind of thing worth pinning down with a handful of unit tests rather
  than only exercising via a full projection.
- Each step of the drawdown solver's ordering (§5.7.3) — e.g.
  `fillFromPersonalAllowance`, `fillFromTaxFreeBucket`,
  `fillFromBasicRateOrCGT`, `fillFromHigherRate` — as its own function
  taking "shortfall remaining, buckets available" and returning "amount
  drawn from this step, shortfall remaining after," so the solver itself
  is just these steps composed in order (§9.4 below extends the same
  principle to the Income Source/Drain catalog layer).

A useful review heuristic: if a function can't be unit tested without
constructing a full Scenario/Household, or if its test has to assert more
than one tax mechanic's worth of behaviour at once, it's a signal the
function should be split further. The per-tax-year golden-file and
scenario-level integration tests (§12) exist to catch these functions
*composed together* correctly — they are not a substitute for each one
being provably correct on its own first.

### 9.4 Income Source / Income Drain plugin architecture
The composable model in §3.11 is implemented as a small **registry** the
calculation engine and the client app's UI/validation layer both share
(there's no separate API to keep in sync with, since both live in the same
static bundle, §9.1):

- Each catalog type (`Salary`, `RentalIncome`, `MortgagePayment`, …)
  implements one shared interface — roughly: an input schema (for
  generating/validating the UI form, §3.11, including its validation
  rules per §3.12), a pure `calculateForYear(scenarioState, yearContext)
  → amount` function, and its declared `taxCategory` or `taxTreatment`.
  Registering a new type means adding one module and one registry entry —
  the simulation loop (§5.1), the generic add/edit/remove UI, and input
  validation all pick it up automatically without being individually
  modified. One type,
  `TargetDrawdownIncome` (§5.7, §3.11), is a deliberate exception: its
  `calculateForYear` returns a **breakdown across multiple buckets**
  rather than a single `{amount, taxCategory}` pair, since its whole job
  is to solve *where the money comes from* for a given target. The shared
  interface accommodates this as an optional richer return shape rather
  than forcing every type into the simple case.
- The year-by-year simulation loop (§5.1) never special-cases a type by
  name; it iterates "for every active `IncomeSource`, call its
  `calculateForYear` and add the result to gross income under its
  `taxCategory`; for every active `IncomeDrain`, call its
  `calculateForYear` and subtract it, applying its `taxTreatment`." This
  is what keeps §5.2–§5.7's tax mechanics (Income Tax, NI, Marriage
  Allowance, the rental mortgage-interest credit, drawdown ordering, …)
  as generic functions of `taxCategory`/`taxTreatment` rather than
  bespoke per-type logic scattered through the simulation.
- Because each type's `calculateForYear` is a pure function with a small,
  explicit input shape, it is unit tested completely in isolation — no
  Scenario, Household, or full simulation required — which is the
  concrete mechanism behind the "each one can then be unit tested"
  requirement (§3.11, §12).
- The UI's "+ Add income source" / "+ Add drain" picker is generated
  directly from the registry (type name, short description, input schema)
  rather than hand-built per type, so the picker and the calculation logic
  can never drift out of sync with each other.

### 9.5 Suggested stack (adjust to team preference — not a hard requirement)
- Calculation engine: TypeScript, framework-agnostic, published as an
  internal package the client app imports directly — no separate service
  boundary to cross.
- Client app: a static-site-generating framework or plain SPA (e.g.
  React/Vite, or a static-export Next.js build with no server runtime) —
  the deployment artifact is static files, not a running Node process —
  with a charting library (e.g. Recharts/D3) for the visualisations in §7.
- Local persistence (§9.2): IndexedDB via a small wrapper library (e.g.
  Dexie or `idb`) for auto-save; the browser's native file download/
  `<input type="file">` (or the File System Access API where supported,
  for a more native "Save"/"Save As" feel) for export/import.
- Hosting: any static host (§9.1) — no server, no database, no auth
  system to build or maintain.
- **Browser support: current and previous major version of Chrome,
  Firefox, Safari, and Edge only** — no IE11 or legacy-browser support,
  and no polyfilling to reach older versions. This is a deliberate scope
  decision, not an oversight: it lets the app use modern JS/CSS/Web
  Platform features (IndexedDB, `Intl.NumberFormat`, CSS Grid, ES2022+)
  without transpilation overhead or fallback code paths, which matters
  more than usual here because §9.2's persistence design already leans on
  IndexedDB being reliably available. The File System Access API
  specifically is Chromium-only even among modern browsers (not in
  Firefox or Safari as of writing) — the native file download/
  `<input type="file">` path (§9.2) is therefore the baseline for
  export/import on every supported browser, with the File System Access
  API used only as a progressive enhancement where present, not a
  requirement.

### 9.6 Numeric precision and rounding

Every monetary value is represented and stored as **integer pence**
internally, never as a floating-point number of pounds — standard IEEE
754 floating-point cannot represent amounts like £0.10 exactly, and
compounding that error across a 50-year, many-account simulation (§5.1)
would produce visibly wrong penny-level results and, worse, golden-file
test failures (§12) that are actually rounding artifacts rather than
logic bugs. Pounds-and-pence values are only converted to/from this
integer representation at the edges: parsing user input, and formatting
for display or export.

- **Round to the nearest penny (round-half-up, matching HMRC's own
  convention) at the output of every calculation function described in
  §9.3** — not just once at the very end of a year's calculation. Chaining
  unrounded intermediate values through several composed functions (e.g.
  `taperPersonalAllowance` → `applyIncomeTaxBands` → the Marriage
  Allowance transfer, §5.2) is exactly the kind of drift that makes a
  result differ from HMRC's own worked examples by a penny or two, which
  then reads as a bug in golden-file tests (§12) even when the underlying
  logic is correct.
- **Percentages and rates** (tax rates, growth rates, uprating
  percentages) are the one place fuller decimal precision is kept
  throughout the calculation — only the final monetary amount they're
  applied to gets rounded to the penny, not the rate itself.
- This applies equally to values that are already real-terms-converted
  (§5.8): a real rate derived via the Fisher equation keeps its full
  precision as a rate, but the moment it's used to grow a monetary
  balance, that resulting balance is rounded to the penny before being
  carried into the next year.
- The Lump Sum Allowance, Annual Allowance carry-forward, and any other
  cross-year running total (§5.4) are stored and accumulated in integer
  pence too, for the same reason — a running total that silently drifts
  by fractions of a penny over a 50-year simulation is a subtle, hard-to-
  spot correctness bug.

### 9.7 Performance target

§9.1 promises instant "what if" feedback as a user edits an input — this
needs a concrete target, not just an aspiration, since it's a real
architecture input for Phase 1 (§13): whether a naive full recompute on
every edit is good enough, or whether the engine needs memoisation/
incremental recompute from the start.

- **Target: a full recompute of the worst-case v1 scenario — a two-person
  household, 50-year horizon, every account type populated, decumulation
  active with the household drawdown optimiser running — completes in
  under 100ms** on the browser support baseline (§9.5's current/previous-
  major-version Chrome/Firefox/Safari/Edge, no artificially throttled
  hardware assumed). 100ms is the standard threshold past which an edit
  starts to feel like it "loaded" rather than responded instantly.
- **Start with a naive full recompute on every change, not incremental
  recompute** — given §9.3's small-pure-function design, the total work
  for the worst-case scenario is on the order of 50 years × ~10 Income
  Sources/Drains × a handful of small function calls each: tens of
  thousands of simple arithmetic operations, not millions. This is very
  likely fast enough without memoisation, and premature incremental-
  recompute machinery would add real complexity (cache invalidation
  bugs are exactly the kind of thing that undermines the correctness
  §9.3 is built around) for a performance problem that may not exist.
  Profile against the 100ms target once Phase 1's worst-case-shaped
  scenario is buildable (roughly by Phase 4–5, §13, once decumulation and
  the household optimiser both exist) and only add incremental recompute
  if the naive approach actually misses the target.
- Debounce recompute-on-every-keystroke inputs (e.g. typing a salary
  figure) the same way §9.2 debounces auto-save, so a fast typist doesn't
  trigger dozens of full recomputes per second regardless of how fast any
  individual recompute is.

### 9.8 Offline support (PWA)

**v1 ships as an installable, offline-capable Progressive Web App.** This
is a natural, low-cost extension of the no-backend design (§9.1) rather
than a separate feature: every asset the app needs is already static and
already shipped up front, and all persistence is already local (§9.2), so
there is no backend to be unreachable from in the first place — the only
work is telling the browser to cache the app shell for offline use and
declaring it installable.

- A service worker caches the built static assets (HTML/CSS/JS, and the
  bundled `TaxYearRuleSet` data, §9.1) on first load, so the app opens and
  fully functions — enter data, get a projection, save locally — with no
  network connection on any subsequent visit, on any device it's been
  opened on before.
- A web app manifest makes it installable ("Add to Home Screen" / desktop
  install), so it can be opened like a native app rather than only via a
  browser tab — a meaningful trust/positioning signal for the same reason
  §10 already flags the no-backend design as one: it reinforces that this
  tool doesn't need the internet, doesn't have a server it talks to, and
  isn't sending anything anywhere.
- Service worker updates (a new deploy shipping a new tax year's data,
  §9.1) follow the standard PWA pattern: the new version downloads in the
  background and activates on next load, with a simple in-app "a new
  version is available, refresh to update" prompt rather than silently
  swapping tax data underneath an open tab.
- This composes with §9.2's schema-version handling: a user on an old
  cached (offline) app version importing a file exported by a newer app
  version is exactly the "file newer than the app can read" case that
  policy already covers.

---

## 10. Security, Privacy & Compliance

The no-backend design (§9.1) is the single biggest lever this product has
on this section: **the operator of this site never receives, transmits,
stores, or processes a single user's financial figure.** Every calculation
happens in the user's own browser; persistence is local to their own
machine or a file they hold (§9.2). This is worth stating plainly to
users as a trust/positioning point for a tool asking people to enter
sensitive financial detail, not just as an internal architecture note.

- Because no financial data ever reaches a server, most of the usual
  "sensitive data at rest/in transit" concerns (database encryption,
  access control, breach exposure) simply don't apply — there is no
  database. The residual risk moves entirely to the client (§9.2): data
  sits unencrypted in the user's own browser storage, and any XSS
  vulnerability in the app is now a direct path to exfiltrating it (there's
  no backend left to compromise instead, so the client *is* the attack
  surface). Mitigate with a strict Content Security Policy, no third-party
  scripts/trackers/ad tags on the page, disciplined dependency hygiene
  (the site's JS supply chain is the main thing to keep hardened), and no
  data exported to `window` globals or accessible outside the app's own
  code.
- **No analytics or error-tracking tool may ever receive financial
  payloads.** If usage analytics or crash reporting (e.g. Sentry,
  PostHog) are added at all, they must be configured to capture only
  usage/performance events and stack traces with financial values
  explicitly scrubbed — this needs to be an enforced engineering rule
  (e.g. a lint check or a code-review checklist item), not an assumption,
  since it's easy for a stray `console.error(scenario)`-style call or an
  error boundary to leak an entire financial picture into a third party's
  logs by accident.
- UK GDPR / Data Protection Act 2018 exposure is minimal by design: with
  no server-side processing of personal data, there's no backend "data
  controller" role for most of the Act's obligations to attach to. This
  doesn't eliminate every consideration (e.g. if analytics/crash reporting
  is added, that itself may process some personal data and needs its own
  lawful-basis assessment; a future feature reintroducing a backend, §14,
  would reopen this whole section) — but for the static-site-only v1, it's
  a materially smaller compliance surface than a typical financial web app,
  and worth confirming with counsel as a deliberate design choice rather
  than an assumption.
- The app must not present itself as giving regulated financial advice
  (FCA-regulated activity) — display a clear, persistent disclaimer, and
  avoid language that reads as a personal recommendation ("you should",
  "we recommend") rather than an illustrative projection ("if you
  contribute X, based on your assumptions the projection shows Y").
- Consider whether the product needs FCA authorisation or an exemption
  (e.g. "generic advice"/guidance-only positioning) — this is a legal
  question to resolve with counsel before launch, not an engineering one,
  but it constrains product copy and feature scope (e.g. no "recommended
  action" buttons).

---

## 11. Assumptions & Limitations (v1)

- **Assumes full-year UK tax residency for every person modelled**, with
  England as their Income Tax jurisdiction (§1.2) — someone who is
  non-UK-resident for all or part of a tax year, has split-year treatment,
  or is UK resident but non-domiciled (with the remittance basis or other
  non-dom-specific rules in play) will get an incorrect projection. This
  is implicit throughout §5 rather than checked anywhere explicitly; v1
  has no residency/domicile input at all and doesn't need one as long as
  this assumption is stated plainly rather than silently baked in.
- **No cross-device sync and no durable server-side backup** (§1.1, §9.2)
  — a plan exists only in one browser's local storage and in whatever
  files the user has explicitly exported. Clearing browser data, and not
  having a recent export, means genuine, unrecoverable data loss with no
  "contact support to restore my account" fallback, because there is no
  account. The UI's periodic export nudge (§9.2) is a mitigation, not a
  fix, and this trade-off should be stated to users plainly, not
  discovered by them the hard way.
- Deterministic growth rates only; no market volatility/sequence-of-returns
  risk modelling (flag clearly in the UI that real markets don't grow
  smoothly).
- A single flat inflation rate for the whole plan (§3.10, §5.8) — no
  modelling of varying inflation year to year, and confirmed near-term tax
  thresholds are deflated using this same flat assumption rather than
  actual historical CPI, which can slightly misstate real values for the
  first year or two of a plan.
- Households are limited to at most two people (§1.2); no modelling of
  dependents, children's savings (e.g. Junior ISA), or households of three
  or more adults in v1.
- No self-employment (Class 2/4 NI, different pension mechanics) in v1 —
  rental property income is modelled (§5.6), but is treated as investment
  income, not a trade, and never triggers Class 2/4 NI even at volume
  (correct for most individual landlords, but not for anyone running
  furnished holiday lets or a property trade, which HMRC treats
  differently — out of scope for v1).
- Property modelling is limited to a small number of properties per
  household with straightforward ownership (main residence plus, at most,
  a handful of simple buy-to-lets); no HMO (House in Multiple Occupation)
  licensing costs, furnished holiday let rules, Stamp Duty Land Tax
  modelling on a future purchase, or company-owned (limited company
  buy-to-let) structures in v1.
- No inheritance tax modelling in v1 (relevant to pension death benefits
  post-2027 IHT changes — worth flagging as a known future rule change to
  track, not modelled yet).
- Tax rule data must be manually reviewed each year against HMRC/gov.uk
  publications — there is no automated feed of official rates.

---

## 12. Testing Strategy

- **Tax-mechanic unit tests** (the true base of the pyramid, §9.3): every
  small function described in §9.3 — band application, Personal Allowance
  taper, NI, each pension relief mechanism, the rental mortgage-interest
  credit, CGT, Private Residence Relief, real/nominal conversion, each
  uprating policy, each drawdown-solver step — gets its own unit tests
  against fixed numeric inputs, independent of everything else. These are
  the fastest, most numerous, and most exhaustively edge-case-covering
  tests in the suite (band boundaries, taper reaching exactly £0, a
  freeze-end date landing mid-plan) precisely because each function is
  small enough that its entire input space is enumerable.
- **Per-type unit tests** (§9.4): every Income Source and Income Drain
  type ships with its own isolated unit tests, built on top of the
  tax-mechanic functions above — given fixed inputs and a fixed year
  context, assert the exact amount contributed/deducted and the exact
  `taxCategory`/`taxTreatment` applied. These run without a Scenario, a
  Household, or the year-by-year loop, and are what lets a new type (e.g.
  adding "Class 2/4 self-employment income" on the Roadmap, §14) be proven
  correct on its own before it's ever exercised by
  a full projection.
- **Drawdown solver tests**: `TargetDrawdownIncome`'s bucket-ordering
  logic (§5.7.3) tested directly against known scenarios — e.g. a target
  fully coverable within Personal Allowance draws nothing from the ISA; a
  target that exhausts Personal Allowance and the tax-free bucket
  correctly escalates into Basic Rate pension income vs CGT-exempt GIA
  gains and picks the cheaper of the two; a target larger than all
  available buckets combined is flagged as a shortfall rather than
  silently under-delivered; and, for a household, the combined-target
  split across two people is checked against a hand-computed cheaper
  alternative to confirm the optimiser actually finds it.
- **Golden-file tests**: for each published TaxYearRuleSet, a set of
  hand-verified input→output pairs (e.g. "salary £45,000, pension 5% net
  pay, no other income → take-home £X, tax £Y") sourced from HMRC's own
  calculators or published examples; these must pass before any rule-set
  or engine change ships.
- **Property-based tests** (in the generative-testing sense — random/
  fuzzed inputs checked against invariants, not tests of the real-estate
  `Property` entity) on the engine's invariants: e.g. net worth never
  silently goes negative without a flagged shortfall; tax paid is never
  negative; ISA contributions never silently exceed the annual limit
  without a warning.
- **Regression tests** comparing full multi-year projections against
  previously-approved snapshots, to catch unintended changes when the
  engine is refactored.
- **Scenario-level integration tests** covering the interacting edge
  cases explicitly, since these are where tax engines usually break:
  Personal Allowance taper crossing a pension contribution change,
  MPAA triggering mid-plan, salary sacrifice vs relief-at-source
  producing different net outcomes for an
  otherwise identical scenario, State Pension starting mid-tax-year,
  Marriage Allowance transfer changing which of two people is the better
  source for a given year's withdrawal, a joint account's income
  split correctly taxed against each person's own bands, rental profit
  pushing a person into a higher Income Tax band and correctly reducing
  their mortgage-interest tax credit's marginal benefit, and a main
  residence sale correctly applying full Private Residence Relief while
  an otherwise-identical rental property sale correctly applies CGT.
- **Real/nominal round-trip tests**: converting a nominal input rate to
  real and back reproduces the original figure; a zero-inflation scenario
  produces identical real and nominal outputs (real terms collapses to
  nominal when inflation is 0%, a useful sanity check on the whole §5.8
  mechanism); a "frozen in cash terms" threshold in a positive-inflation
  scenario visibly erodes in real terms year over year, while the same
  threshold under "inflation-linked" stays exactly flat; and a fixed-rate
  mortgage payment's real cost declines correctly over its fixed term.
- **Rounding tests** (§9.6): every calculation function's output is an
  exact integer number of pence, never a fractional penny, for a battery
  of inputs specifically chosen to expose float drift (values with
  recurring binary fractions, e.g. amounts involving thirds or tenths of
  a penny before rounding); a long-running (50-year) simulation's final
  balances match a penny-exact hand-computed result rather than drifting;
  and a rounding regression test comparing the engine's output penny-for-
  penny against an HMRC-published worked example, not just "close enough."
- **Validation tests** (§3.12): each catalog type's declared hard-block
  and soft-warning rules are tested directly — a hard-block condition
  prevents saving and surfaces the expected field-level error; a soft-
  warning condition still produces a valid `ProjectionResult` alongside
  the expected flag; and no field is left without an assertion covering
  which tier it falls into, since an untested validation rule is exactly
  where "it validates in the UI but the engine still crashes on it" bugs
  hide.
- **Schema migration tests** (§9.2): each version-to-version migration
  function is tested with a fixture file at the old schema version,
  asserting the exact migrated output; importing a same-version file
  loads unchanged; importing a file newer than the app's schema version
  is rejected with the expected message rather than attempting a lossy
  read; and a full chain test imports a v1 fixture into an app several
  schema versions ahead, confirming the whole migration chain composes
  correctly, not just each individual step in isolation.
- **Performance benchmark** (§9.7): the worst-case scenario (two-person
  household, 50-year horizon, every account type, active decumulation
  with the household optimiser) is benchmarked on every CI run against
  the 100ms target, so a regression that quietly makes the engine slower
  is caught the same way a correctness regression would be, not
  discovered later from user complaints about a sluggish UI.

---

## 13. Implementation Build Sequence

v1's scope, as specified, is broad: two-person households, four
account/property types with rental income and CGT, a real-terms engine
with three tax-threshold uprating policies, a ~10-type composable
Income Source/Drain catalog, a multi-step drawdown solver with household
optimisation, and dual-mode local persistence. Building all of it at once
is a real risk — there is no point optimising a household drawdown split
before the single-person engine underneath it is solid. Build in phases,
each one a thin but complete slice that can be exercised end-to-end
(entered, saved, projected, viewed) before the next phase adds to it.

**This is a build-order decision, not a priority statement**: §1.3
requires single-person and two-person plans to ship as equally first-
class modes, "not household-as-an-afterthought" — sequencing two-person
support as Phase 5 doesn't contradict that, because every phase here
still ships before v1 is considered done. It's sequenced last specifically
*because* it's the highest-risk phase to build without a proven
foundation underneath it, not because it matters less.

1. **Foundation**: single person only (two-person support, §1.3, deferred
   to Phase 5), accumulation phase only. One Salary Income Source, one
   `PensionAccount` with one relief mechanism, one ISA. The real-terms
   engine core (§5.2 Income Tax, §5.3 NI, §5.8 real/nominal conversion),
   the Income Source/Drain registry (§9.4) with its first two catalog
   entries — including their validation rules from the start (§3.12),
   not bolted on later — integer-pence arithmetic (§9.6), and the static
   site shell with local persistence (§9.1, §9.2: IndexedDB auto-save
   first, file export/import and schema-migration scaffolding can follow
   in this phase or slip to Phase 2) and offline/PWA scaffolding (§9.8) —
   cheaper to build into the shell now than retrofit later. Goal: prove
   the whole architecture end-to-end on the thinnest possible slice —
   enter a salary and a pension, see a correct multi-year Income Tax/NI
   projection, close the tab, reopen it, see the same numbers.
2. **Full accumulation catalog**: remaining pension relief mechanisms and
   the Annual Allowance/MPAA (§5.4), GIA and cash accounts with dividend/
   savings taxation (§5.5), the remaining accumulation-phase catalog
   types (§3.11's Source/Drain table), file export/import if not already
   done in Phase 1, and the tax breakdown view (§4, journey 5).
3. **Property & rental**: `Property`/`Mortgage` entities (§3.8), rental
   income tax and the mortgage-interest credit (§5.6), a planned property
   sale with CGT/PRR, and the property sale scenario view (§7).
4. **Decumulation**: the `TargetDrawdownIncome` composite type (§3.11),
   the two-bucket model and solver (§5.7.1–§5.7.3), and the drawdown
   sourcing table and bucket-balance graph (§4 journey 6, §7) — this is
   the single most algorithmically complex piece of the spec and
   benefits from having a fully working single-person accumulation engine
   underneath it before it's tackled.
5. **Two-person households**: `Household`/second `Person`, Marriage
   Allowance (§5.2), joint account income splitting and interspousal
   transfers (§5.5), household drawdown optimisation (§5.7.4), and
   survivorship (§5.7.5) — deliberately last, since every mechanic in
   Phases 1–4 needs to already be correct for one person before the
   two-person interactions on top of them can be meaningfully tested.
6. **Polish**: scenario comparison (§4 journey 4), CSV/PDF export (§4
   journey 7), key flags/warnings (§7), and an accessibility/performance
   pass against whatever non-functional targets are set before launch.

Each phase's tax-mechanic and per-type unit tests (§12) should be written
and passing before moving to the next phase — the golden-file and
scenario-level integration tests accumulate coverage as each phase's
mechanics come online, rather than being written once at the end.

---

## 14. Roadmap (post-v1)

- **Scottish Income Tax bands.** v1 is English-rates-only (§1.2); adding
  Scotland means reintroducing a region concept — a per-person region
  field (§3.2), a region dimension on the Income Tax portion of the tax
  table (§6), and Scotland's additional bands (Starter, Basic,
  Intermediate, Higher, Advanced, Top) — while NI, dividend tax, CGT, and
  pension rules stay UK-wide and unaffected, since only Income Tax is
  devolved.
- Households of more than two adults, and dependents/children (e.g.
  Junior ISA modelling, and — once children are modelled at all — the
  High Income Child Benefit Charge, which only applies to a household
  actually claiming Child Benefit) as part of a household plan.
- Student loan repayment deductions (Plan 1/2/4/5, Postgraduate Loan) as
  an additional payroll deduction alongside Income Tax and NI (§5.3).
- Monte Carlo / stochastic return modelling for a probabilistic ("X%
  chance of running out of money") view alongside the deterministic one.
- Self-employment income and Class 2/4 NI.
- Furnished holiday lets, HMO properties, Stamp Duty Land Tax on a
  modelled future purchase, and limited-company property ownership.
- Inheritance Tax modelling, including pensions within the estate
  post-April 2027 changes.
- **Scenario sharing without a backend**: sharing today already works by
  handing over the exported file itself (§9.2) — email it, drop it in a
  shared drive, hand it to an adviser who opens it in their own instance
  of the same static site. A "share via link" model (a URL someone else
  can open to see a read-only copy) is explicitly **not** compatible with
  the no-backend principle (§1.1, §9.1) as it requires somewhere to host
  the shared data; if ever pursued, treat it as a deliberate exception to
  that principle requiring its own security/privacy review, not a simple
  feature add.
- **Open Banking / pension-provider integration**: also in tension with
  the no-backend design — most institutions require a registered backend
  client (for token exchange/credential handling) rather than a pure
  static site talking to their APIs directly from the browser. Would need
  either a minimal backend built and scoped specifically for this (and
  reviewed as an explicit, contained exception to §1.1's no-backend goal,
  ideally never touching or storing the financial data itself, only
  brokering the OAuth handshake) or an institution that supports a fully
  client-side integration flow.

---

## 15. Pre-Implementation Dependencies

Everything else this spec identified as needed before/during
implementation (real tax data, a rounding policy, a build sequence,
browser support, a performance target, offline support, a validation
policy, a State Pension estimation formula, a schema-migration policy) is
now specified in the sections above. Two items remain that can't be
resolved by writing more spec — they need a person, not a decision, and
should run in parallel with Phase 1 (§13) starting now rather than
blocking it:

- **Visual/UI design.** This document specifies functionality,
  information architecture, and user journeys (§4) in enough detail to
  build the calculation engine and data model against directly, but it
  does not specify what anything looks like. Wireframes (at minimum) for
  the journeys in §4 are a real prerequisite for frontend work
  specifically — the engine/data-model phases (§13, Phases 1–2) can start
  without them, but UI implementation will stall without at least
  low-fidelity wireframes to build against. Owner: TBD.
- **FCA / regulated-advice legal sign-off** (§10). Whether this product
  needs FCA authorisation or a specific guidance-only/generic-advice
  positioning is a legal question, not an engineering one, but its answer
  constrains product copy (§10 already assumes "no recommended action
  buttons" and illustrative-projection phrasing as a placeholder position)
  that will otherwise need to be written once now and rewritten later if
  counsel's answer differs. Start this in parallel with Phase 1; it
  should be resolved before any public launch, not before writing code.
  Owner: TBD.

Both are tracked here rather than left as asides inside other sections so
they're visible as open items with no default answer, not implicitly
assumed resolved.
