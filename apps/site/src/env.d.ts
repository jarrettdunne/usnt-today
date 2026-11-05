/// <reference types="astro/client" />

declare namespace App {
  interface Locals {
    /** Men or women, from ?pool= or the "pool" cookie. Set in middleware. */
    pool: import('@usnt/db').Pool;
  }
}
