---
name: shopping
description: "Show products to buy as product cards. Use when asked to find, compare or buy a product."
---

# Products as cards

When your answer is products the owner could buy, put them in a ```` ```products ```` fence in your reply, holding a JSON list. The app draws it as product cards, on the web and on Android: the **first product is your pick**, a large card with its photo, price, rating, store, your one-line why, the delivery, and **Open** (the store's page) and **Save**; the others are compact rows under it, each opening its store.

````
Four fit. Lift Pro 140 is the best value: two motors, 4.6 from 2140 reviews, here Friday.

```products
[
  { "name": "Lift Pro 140", "url": "https://www.amazon.de/dp/B0C1", "image": "https://m.media-amazon.com/images/I/61a.jpg",
    "price": "€379", "store": "amazon.de", "rating": 4.6, "reviews": 2140, "arrives": "Arrives Friday",
    "why": "Two motors, steady at full height, 10-year frame warranty." },
  { "name": "Ergo Frame S2", "url": "https://www.x-kom.pl/p/1", "image": "https://cdn.x-kom.pl/i/s2.jpg",
    "price": "€339", "was": "€399", "store": "x-kom.pl", "rating": 4.4, "arrives": "Arrives tomorrow" }
]
```
````

## Fields

| Field | What it is |
|---|---|
| `name` | The product's short name, as the store writes it, without the store's marketing (needed: a product without one is left out) |
| `url` | The product's page at the store, `https` only |
| `image` | The product's photo at the store, `https` only: the address of the image itself (from the page's `og:image` or its main picture), not of the page. Without one, a placeholder |
| `price` | The price now, as the store shows it, with its currency: `"€379"`, `"1 299 zł"` |
| `was` | The price before a sale, only when the store shows one: the card strikes it through and shows how much less |
| `store` | The store's name or domain: `"amazon.de"` |
| `rating`, `reviews` | Stars out of 5 and how many reviews, as the store shows them |
| `arrives` | When it would arrive, in a few words: `"Arrives Friday"`, `"Arrives in 3–5 days"` |
| `why` | For the pick only: one sentence on why it is the one (what sets it apart for what the owner asked) |

## Rules

- **One line above the cards**: the outcome (how many fit, which you pick and why in a few words). The cards say the rest; don't list the products again in text.
- **Best first.** The first is the one you would buy for the owner; then the others, best to worst. Two to six products; at most ten are drawn.
- **Real values only.** Every price, rating, photo and date comes from the store's page you read in this task. Leave a field out rather than guess it; never a photo address you didn't see.
- **Valid JSON.** A fence that isn't valid JSON is shown as its code. No HTML: everything is drawn as text.
- Not for one product the owner already chose, or a list of things that aren't for sale: use plain text there.
- **Save** puts the product in `Saved-products.md` among your files. When the owner asks what they saved, read it there.
