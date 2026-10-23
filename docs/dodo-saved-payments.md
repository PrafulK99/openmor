# Dodo saved payments: what we tested, and why agent repeat purchases are parked

**Status: parked.** Agent-initiated repeat purchases (a buyer approves once, the agent charges later
without the buyer present) are not possible today with Dodo Payments' one-time checkout. This page
records what we tested so nobody has to repeat it, and what would unblock the work.

The unfinished implementation (buyer links, approval emails and page, saved-method checkout) lives on
the branch `feat/buyer-links`. It is not merged and should not be until the roadmap condition below is
met.

## Summary

| Question | Answer |
| --- | --- |
| Does a normal hosted checkout save the buyer's card? | **Yes**, automatically. The hosted page can list it. |
| Can we find that saved card through the API? | **No.** The payment-methods list endpoint returns nothing. |
| Can we charge it through the API without the buyer? | **No.** A confirmed charge is rejected: `422 "Payment method not found for this customer"`. |
| Is there another route where the buyer authorizes once and we charge later? | **Yes, with limits:** an on-demand subscription mandate. It needs a subscription product, is charged before tax, creates no fulfilment, and its 3D Secure behaviour is unverified. |

## Roadmap

Agent-initiated repeat purchases are **blocked until Dodo exposes a reusable saved method for
one-time checkouts**: a method that the API lists, that a confirmed one-time checkout accepts, and
that does not need the buyer to type a CVC. Until then OpenMoR supports one purchase path: the buyer
pays on Dodo's hosted checkout page each time (handoff checkout). Do not promise autonomous repeat
purchases in the README, tool descriptions or marketing.

## How we tested

Everything here was run against Dodo **test mode** only, in October 2026, with the `dodopayments`
SDK 2.56.0. We used the SDK, raw HTTP calls, and a headless browser to render Dodo's hosted checkout
page. We made a handful of test payments and one test mandate, then cancelled it. No live-mode
calls were made. Dodo's docs are linked at the end.

## What we found

### 1. A hosted checkout does save the card, but the API never lists it

- Dodo's docs say saving is automatic: "Payment methods are automatically saved when customers
  complete checkout. You don't need to explicitly save them."
- The hosted page never shows a "save this card" checkbox, with or without
  `show_saved_payment_methods`. That matches "automatic".
- `show_saved_payment_methods: true` together with `customer: { customer_id }` makes the hosted
  payment step show a **Saved** tab listing the card (brand, last four digits, expiry) with a CVC
  box. Without the flag there is no Saved tab. The flag only controls whether saved cards are
  listed on the page. Both customer shapes (`customer_id` and `email`) are accepted by the API.
- `GET /customers/{customer_id}/payment-methods` (SDK `customers.retrievePaymentMethods`) returned
  `200 {"items":[]}` for a customer who had paid with a card several times and whose saved card the
  hosted page showed. The endpoint takes no query parameters (`page_size` changes nothing).
- A payment's own record has `payment_method_id` empty, even when the payment was made with the
  saved card. So the id is not available there either.
- The list stayed empty after paying with the saved card, and after a mandate was authorized.

### 2. The saved card is not reusable without the buyer

The hosted page's own saved-methods call (observed in the browser, structure only) describes the saved
card with:

- `recurring_enabled: false`
- `requires_cvv: true`
- `saved_to_locker: true`

We read this as: the card saved after a one-time purchase is for the buyer to reuse on the hosted page
(with the CVC typed again), not for repeat charges by a merchant or agent. This is our interpretation;
Dodo does not document these fields.

### 3. A confirmed API charge with a payment method id is rejected

We tried the documented one-click shape: a checkout session with `customer: { customer_id }`,
`payment_method_id` and `confirm: true`, using the id the hosted page lists for the saved card
(the id only exists in the hosted page's own response; the public API does not return it).

- Dodo rejected the request immediately: **HTTP 422, `INVALID_REQUEST_PARAMETERS`,
  "Payment method not found for this customer"**.
- No payment was created, so there was no payment status to inspect. We did **not** observe a
  "buyer must be present" status or error in this route: the method is simply unknown to the charge
  API.

### 4. Looking customers up by email

- `GET /customers?email=` is an **exact, case-sensitive** match. An upper-case or capitalised
  version of the same address found nothing; a shorter local part, a plus-address and another domain
  also found nothing; a string that is not an email address is rejected with HTTP 400.
- The SDK says that, unless a new customer is requested, "the most recently created customer object
  with the given email is used". So several customers with one email are possible in principle. In our
  test account there was exactly one customer.
- Our adapter lowercases emails. A customer stored in mixed case would therefore be missed. A
  safer lookup would use the customer id from the buyer's own paid order.

### 5. The on-demand subscription route works, with limits

Dodo's documented way to "authorize a customer's payment method once and then charge variable amounts
whenever you need" is an on-demand subscription: a checkout session with
`subscription_data.on_demand`, then `POST /subscriptions/{subscription_id}/charge`.

What we observed:

| Check | Result |
| --- | --- |
| Mandate on a **one-time** product | Rejected: `422 "Subscription data configuration is only allowed for subscription products."` |
| Mandate on a **subscription** product (`mandate_only: true`) | Accepted. The hosted page shows a €0.00 "On Demand Subscription" and the text "By confirming your subscription, you allow us to charge your payment method for future payments as applicable." |
| Reusing the buyer's saved card to authorize | **Not offered.** The mandate page has no Saved tab, so the buyer enters a card again. |
| State after authorizing | The subscription becomes `active`, `on_demand: true`, and its record carries a `payment_method_id`. This is the only place the API exposed a method id. The payment-methods list endpoint still returned nothing. |
| `POST /subscriptions/{id}/charge` with no buyer present | **Succeeded in about 2 seconds** (`charge_type: on_demand`). |
| Amount | `product_price` is **before tax**: a request for €9.57 was charged as €11.39 (German VAT, 19%). A quote's tax-inclusive total cannot be passed as is. |
| What the charge is | The payment has **no product line**. It is money moving under the subscription product, with only the metadata we sent. Dodo issues no licence key, credits or other fulfilment for a one-time product bought this way. |
| Using the mandate's method id for a confirmed **one-time** checkout | Rejected with the same `422 "Payment method not found for this customer"`. |
| Cancelling the subscription | Works, and revokes the mandate. |

### 6. 3D Secure and "buyer must be present": not verified

Test mode gave us no way to provoke authentication, so this is **documentation only, not observed**:

- Dodo lists no test card that triggers 3D Secure. Its test-card page lists success cards, decline
  cards, and one card for subscription renewal failure.
- The Cards page says a renewal with no customer present cannot show a 3DS challenge; if it fails
  authentication the subscription moves to `on_hold` (or `past_due` first with a grace period).
- Payment status `requires_customer_action` means the customer must complete a 3DS challenge. Failed
  authentication appears as the error codes `AUTHENTICATION_REQUIRED`, `AUTHENTICATION_FAILURE` and
  `AUTHENTICATION_TIMEOUT`.
- Real cards under European (PSD2) rules may well require authentication on off-session charges. Our
  tests used a test card that never does.

## What this means for OpenMoR

| Approach | Verdict |
| --- | --- |
| Handoff checkout, buyer pays on Dodo's page every time | **Works. This is what OpenMoR supports.** |
| Charge the card saved by a hosted checkout (`payment_method_id` + `confirm: true`) | **Blocked.** The API does not list the card and rejects a charge with it. |
| On-demand subscription mandate, then charge | **Technically possible, not a fit yet.** Needs a subscription product per merchant, a pre-tax price, a separate way to deliver what was bought, and a real-card 3DS check. |

The code on `feat/buyer-links` assumed the second row would work. It finds a saved card through
`customers.retrievePaymentMethods`, which is always empty, so no buyer link can be approved against
real Dodo today.

## Questions for Dodo

If this is taken up again, these answers decide whether it is worth it:

1. Is a card saved by a one-time hosted checkout meant to be chargeable through the API? If so, which
   endpoint returns its id, and why does `retrievePaymentMethods` return nothing?
2. What do `recurring_enabled` and `requires_cvv` mean, and can a one-time checkout save a card for
   off-session reuse (without the buyer typing a CVC)?
3. Can an on-demand mandate be created from a one-time product, or used so that a charge delivers the
   purchased product's fulfilment?
4. How do off-session charges behave for cards that require authentication, and is there a test card
   that simulates it?

## Sources

Dodo documentation read for this work:

- [Upsells & Downsells](https://docs.dodopayments.com/features/upsells-and-downsells) (automatic saving, charging a saved method)
- [Credit & Debit Cards](https://docs.dodopayments.com/features/payment-methods/cards) (`show_saved_payment_methods`, 3D Secure)
- [On-Demand Subscriptions](https://docs.dodopayments.com/developer-resources/ondemand-subscriptions)
- [Test Card Details](https://docs.dodopayments.com/miscellaneous/testing-process)
- [List customer payment methods](https://docs.dodopayments.com/api-reference/customers/get-customer-payment-methods) and
  [List customers](https://docs.dodopayments.com/api-reference/customers/get-customers) (API reference)
- [Create checkout session](https://docs.dodopayments.com/api-reference/checkout-sessions/create) (API reference)
