import { useCallback, useMemo, useReducer, useRef, useState } from "react";
import { RefreshCw, Search, ShoppingBag, Store, Trash2 } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { AbandonmentDialog } from "#/components/abandonment-dialog";
import { CheckoutScreen } from "#/components/checkout-screen";
import { Carousel, CarouselContent, CarouselItem } from "#/components/ui/carousel";
import { CustomizationDrawer } from "#/components/customization-drawer";
import { KioskShell } from "#/components/kiosk-shell";
import { cartReducer, subtotalCents, type CartLineInput, type CartState } from "#/lib/cart";
import { getMenu, type MenuCategory, type MenuProduct } from "#/lib/catalog.functions";
import { useAbandonment, type PaymentContext } from "#/lib/use-abandonment";

export type MenuScreenProps = {
  kioskId: string;
  kioskName: string;
};

const formatCents = (cents: number): string =>
  new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(cents / 100);

const itemCountLabel = (count: number): string => `${count} ${count === 1 ? "item" : "items"}`;

const productHasOptions = (product: MenuProduct): boolean =>
  product.variantGroups.length > 0 || product.addonGroups.length > 0;

const toCartLineInput = (product: MenuProduct): CartLineInput => ({
  productId: product.id,
  categoryId: product.categoryId,
  productName: product.name,
  basePriceCents: product.basePriceCents,
  variants: [],
  addons: [],
});

export const MenuScreen = ({ kioskId, kioskName }: MenuScreenProps) => {
  const menuQuery = useQuery({ queryKey: ["menu"], queryFn: () => getMenu() });
  const [cart, dispatchCart] = useReducer(cartReducer, []);
  const [checkoutCart, setCheckoutCart] = useState<CartState | null>(null);
  const [paymentContext, setPaymentContext] = useState<PaymentContext | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedProduct, setSelectedProduct] = useState<MenuProduct | null>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [cartOpen, setCartOpen] = useState(false);
  const triggerRefs = useRef<Record<string, HTMLButtonElement | null>>({});
  const selectedTriggerRef = useRef<HTMLButtonElement | null>(null);
  const categorySectionRefs = useRef<Record<string, HTMLElement | null>>({});
  const categories = useMemo(() => menuQuery.data?.categories ?? [], [menuQuery.data]);

  const normalizedSearch = searchQuery.trim().toLocaleLowerCase();
  const searchResults = useMemo(() => {
    if (!normalizedSearch) {
      return [];
    }
    return categories.flatMap((category) =>
      category.products.filter((product) =>
        [product.name, product.description ?? "", category.name].some((value) =>
          value.toLocaleLowerCase().includes(normalizedSearch),
        ),
      ),
    );
  }, [categories, normalizedSearch]);

  const scrollToCategory = (categoryId: string) => {
    categorySectionRefs.current[categoryId]?.scrollIntoView({
      behavior: "smooth",
      block: "start",
    });
  };

  const handleProductClick = (product: MenuProduct) => {
    if (!productHasOptions(product)) {
      dispatchCart({ type: "add", item: toCartLineInput(product) });
      return;
    }
    selectedTriggerRef.current = triggerRefs.current[product.id];
    setSelectedProduct(product);
    setDrawerOpen(true);
  };

  const handleCustomizedAdd = (item: CartLineInput) => {
    dispatchCart({ type: "add", item });
  };

  const clearCartAndCheckout = useCallback(() => {
    dispatchCart({ type: "reset" });
    setCartOpen(false);
    setCheckoutCart(null);
    setPaymentContext(null);
  }, []);
  const cancelCheckout = useCallback(() => {
    setCheckoutCart(null);
    setPaymentContext(null);
  }, []);
  const handlePaymentStateChange = useCallback((next: PaymentContext) => {
    setPaymentContext(next);
  }, []);
  const abandonment = useAbandonment({
    cart: checkoutCart ?? cart,
    kioskId,
    payment: paymentContext,
    onCancelPayment: cancelCheckout,
    onClearCart: clearCartAndCheckout,
  });
  const startCheckout = () => {
    setPaymentContext({ phase: "creating_order", orderId: null, attemptId: null });
    setCheckoutCart(cart);
  };
  const handleInteraction = () => {
    abandonment.reset();
  };
  const subtotal = subtotalCents(cart);
  const drawerProduct = selectedProduct;
  const header = (
    <div className="mx-auto flex w-full max-w-6xl items-center justify-between px-5 py-4">
      <div className="flex items-center gap-3">
        <Store aria-hidden className="size-6" strokeWidth={2} />
        <span className="text-heading-s font-semibold">Warm & Melted</span>
      </div>
      <span className="text-body-s text-muted-foreground">{kioskName}</span>
    </div>
  );

  const renderProductCard = (product: MenuProduct) => (
    <button
      aria-label={`${product.name}, ${formatCents(product.basePriceCents)}`}
      className="group flex min-h-64 flex-col overflow-hidden rounded-md bg-card text-left shadow-sm transition-shadow duration-150 hover:shadow-md active:scale-[0.99] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
      key={product.id}
      onClick={() => handleProductClick(product)}
      ref={(element) => {
        triggerRefs.current[product.id] = element;
      }}
      type="button"
    >
      <div className="h-40 w-full overflow-hidden bg-secondary">
        {product.imageUrl && (
          <img alt="" className="size-full object-cover" src={product.imageUrl} />
        )}
      </div>
      <div className="flex flex-1 flex-col gap-2 p-5">
        <div className="flex items-start justify-between gap-3">
          <h3 className="text-heading-s font-semibold">{product.name}</h3>
          <span className="shrink-0 text-body-m font-semibold">
            {formatCents(product.basePriceCents)}
          </span>
        </div>
        {product.description && (
          <p className="text-body-s text-muted-foreground">{product.description}</p>
        )}
        <span className="mt-auto pt-2 text-body-s font-semibold text-primary">
          {productHasOptions(product) ? "Choose options" : "Add to order"}
        </span>
      </div>
    </button>
  );

  const renderCategorySection = (category: MenuCategory) =>
    category.products.length === 0 ? null : (
      <section
        aria-labelledby={`menu-category-heading-${category.id}`}
        key={category.id}
        ref={(element) => {
          categorySectionRefs.current[category.id] = element;
        }}
      >
        <h2 className="mb-4 text-heading-l font-bold" id={`menu-category-heading-${category.id}`}>
          {category.name}
        </h2>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {category.products.map(renderProductCard)}
        </div>
      </section>
    );

  if (checkoutCart) {
    return (
      <div onPointerDown={handleInteraction}>
        <CheckoutScreen
          cart={checkoutCart}
          onCancel={cancelCheckout}
          onComplete={clearCartAndCheckout}
          onPaymentStateChange={handlePaymentStateChange}
        />
        <AbandonmentDialog
          onKeepOrdering={abandonment.reset}
          open={abandonment.warningOpen}
          secondsRemaining={abandonment.secondsRemaining}
        />
      </div>
    );
  }

  if (cartOpen) {
    return (
      <div onPointerDown={handleInteraction}>
        <KioskShell
          bottomBar={
            <div className="mx-auto flex w-full max-w-6xl items-center justify-between gap-4">
              <div aria-live="polite">
                <p className="text-body-s text-muted-foreground">Your order</p>
                <p className="text-heading-m font-semibold">
                  {itemCountLabel(cart.length)} · {formatCents(subtotal)}
                </p>
              </div>
              <div className="flex items-center gap-3">
                <button
                  aria-label="Hide order details"
                  aria-pressed="true"
                  className="inline-flex min-h-12 min-w-12 items-center justify-center rounded-pill bg-primary px-4 py-3 text-primary-foreground transition-colors duration-150 active:scale-[0.97] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
                  onClick={() => setCartOpen(false)}
                  type="button"
                >
                  <ShoppingBag aria-hidden size={20} strokeWidth={2} />
                </button>
                <button
                  className="inline-flex min-h-12 items-center justify-center rounded-pill bg-primary px-6 py-3 font-semibold text-primary-foreground transition-transform duration-150 active:scale-[0.97] disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
                  disabled={cart.length === 0}
                  onClick={startCheckout}
                  type="button"
                >
                  Pay
                </button>
              </div>
            </div>
          }
          header={header}
        >
          <div className="mx-auto flex w-full max-w-6xl flex-col gap-6 px-5 py-8">
            <div>
              <p className="text-body-s font-semibold text-primary">Your order</p>
              <h1 className="text-display-m font-extrabold leading-tight">Order details</h1>
            </div>
            {cart.length === 0 ? (
              <p className="rounded-md bg-card p-6 text-body-l text-muted-foreground">
                Your cart is empty.
              </p>
            ) : (
              <div
                aria-label="Cart details"
                className="flex flex-col divide-y divide-border rounded-md bg-card p-5 shadow-md"
                role="region"
              >
                {cart.map((line) => {
                  const hasDetails = line.variants.length > 0 || line.addons.length > 0;
                  return (
                    <div
                      className={`flex justify-between gap-4 py-4 first:pt-0 last:pb-0 ${
                        hasDetails ? "items-start" : "items-center"
                      }`}
                      key={line.id}
                    >
                      <div>
                        <p className="font-semibold">{line.productName}</p>
                        {hasDetails && (
                          <p className="mt-1 text-body-s text-muted-foreground">
                            {[
                              ...line.variants.map((variant) => variant.optionName),
                              ...line.addons.map((addon) => addon.addonName),
                            ].join(", ")}
                          </p>
                        )}
                      </div>
                      <div className="flex shrink-0 items-center gap-3">
                        <span className="font-semibold">{formatCents(line.unitPriceCents)}</span>
                        <button
                          aria-label={`Remove ${line.productName}`}
                          className="inline-flex min-h-12 min-w-12 items-center justify-center rounded-pill border border-border text-destructive"
                          onClick={() => dispatchCart({ type: "remove", lineId: line.id })}
                          type="button"
                        >
                          <Trash2 aria-hidden size={18} strokeWidth={2} />
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </KioskShell>
        <AbandonmentDialog
          onKeepOrdering={abandonment.reset}
          open={abandonment.warningOpen}
          secondsRemaining={abandonment.secondsRemaining}
        />
      </div>
    );
  }

  return (
    <div onPointerDown={handleInteraction}>
      <KioskShell
        header={header}
        bottomBar={
          <div className="mx-auto flex w-full max-w-6xl items-center justify-between gap-4">
            <div aria-live="polite">
              <p className="text-body-s text-muted-foreground">Your order</p>
              <p className="text-heading-m font-semibold">
                {itemCountLabel(cart.length)} · {formatCents(subtotal)}
              </p>
            </div>
            <div className="flex items-center gap-3">
              <button
                aria-label="Show order details"
                aria-pressed="false"
                className="inline-flex min-h-12 min-w-12 items-center justify-center rounded-pill border border-border px-4 py-3 transition-colors duration-150 active:scale-[0.97] disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
                disabled={cart.length === 0}
                onClick={() => setCartOpen(true)}
                type="button"
              >
                <ShoppingBag aria-hidden size={20} strokeWidth={2} />
              </button>
              <button
                className="inline-flex min-h-12 items-center justify-center rounded-pill bg-primary px-6 py-3 font-semibold text-primary-foreground transition-transform duration-150 active:scale-[0.97] disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
                disabled={cart.length === 0}
                onClick={startCheckout}
                type="button"
              >
                Pay
              </button>
            </div>
          </div>
        }
      >
        <div className="mx-auto flex w-full max-w-6xl flex-col gap-8 px-5 py-8">
          <div className="flex flex-col gap-5">
            <div className="flex flex-col gap-2">
              <p className="text-body-s font-semibold text-primary">Order at your own pace</p>
              <h1 className="text-display-m font-extrabold leading-tight">Menu</h1>
              <p className="max-w-xl text-body-l text-muted-foreground">
                Choose something fresh, then make it yours.
              </p>
            </div>

            <label className="relative block max-w-2xl">
              <span className="sr-only">Search menu</span>
              <Search
                aria-hidden
                className="pointer-events-none absolute left-4 top-1/2 size-5 -translate-y-1/2 text-muted-foreground"
                strokeWidth={2}
              />
              <input
                aria-label="Search menu"
                className="min-h-12 w-full rounded-pill border border-input bg-card py-3 pl-12 pr-4 text-body-l outline-none transition-shadow placeholder:text-muted-foreground focus-visible:border-primary focus-visible:ring-3 focus-visible:ring-primary/20"
                onChange={(event) => setSearchQuery(event.target.value)}
                placeholder="Search the menu"
                type="search"
                value={searchQuery}
              />
            </label>

            {!normalizedSearch && categories.length > 0 && (
              <Carousel
                aria-label="Menu categories"
                className="w-full"
                opts={{ align: "start", dragFree: true }}
              >
                <CarouselContent className="-ml-3">
                  {categories.map((category) => (
                    <CarouselItem className="basis-auto pl-3" key={category.id}>
                      <button
                        className="min-h-12 shrink-0 rounded-pill border border-border bg-card px-5 py-3 text-body-m font-semibold transition-colors hover:bg-secondary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
                        onClick={() => scrollToCategory(category.id)}
                        type="button"
                      >
                        {category.name}
                      </button>
                    </CarouselItem>
                  ))}
                </CarouselContent>
              </Carousel>
            )}
          </div>

          {menuQuery.isPending && (
            <p
              aria-live="polite"
              className="rounded-md bg-card p-6 text-body-l text-muted-foreground"
            >
              Loading the menu…
            </p>
          )}

          {menuQuery.isError && (
            <div
              aria-live="polite"
              className="flex flex-col items-start gap-4 rounded-md bg-card p-6"
            >
              <p className="text-body-l">We couldn’t load the menu.</p>
              <button
                className="inline-flex min-h-12 items-center gap-2 rounded-pill bg-primary px-5 py-3 font-semibold text-primary-foreground"
                onClick={() => menuQuery.refetch()}
                type="button"
              >
                <RefreshCw aria-hidden size={18} strokeWidth={2} />
                Retry
              </button>
            </div>
          )}

          {!menuQuery.isPending && !menuQuery.isError && categories.length === 0 && (
            <p className="rounded-md bg-card p-6 text-body-l text-muted-foreground">
              There are no products available right now.
            </p>
          )}

          {!menuQuery.isPending &&
            !menuQuery.isError &&
            categories.length > 0 &&
            normalizedSearch &&
            searchResults.length === 0 && (
              <div className="flex flex-col items-start gap-4 rounded-md bg-card p-6">
                <p className="text-body-l">No products found.</p>
                <button
                  className="min-h-12 rounded-pill border border-border px-5 py-3 font-semibold"
                  onClick={() => setSearchQuery("")}
                  type="button"
                >
                  Clear search
                </button>
              </div>
            )}

          {!menuQuery.isPending &&
            !menuQuery.isError &&
            categories.length > 0 &&
            normalizedSearch &&
            searchResults.length > 0 && (
              <section aria-labelledby="menu-search-heading">
                <div className="mb-4 flex items-end justify-between gap-4">
                  <h2 className="text-heading-l font-bold" id="menu-search-heading">
                    Search results
                  </h2>
                  <span className="text-body-s text-muted-foreground">
                    {searchResults.length} found
                  </span>
                </div>
                <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                  {searchResults.map(renderProductCard)}
                </div>
              </section>
            )}

          {!menuQuery.isPending &&
            !menuQuery.isError &&
            !normalizedSearch &&
            categories.length > 0 && (
              <div className="flex flex-col gap-10">{categories.map(renderCategorySection)}</div>
            )}
        </div>

        {drawerProduct && (
          <CustomizationDrawer
            onAdd={handleCustomizedAdd}
            onOpenChange={setDrawerOpen}
            open={drawerOpen}
            product={drawerProduct}
            returnFocusRef={selectedTriggerRef}
          />
        )}
      </KioskShell>
      <AbandonmentDialog
        onKeepOrdering={abandonment.reset}
        open={abandonment.warningOpen}
        secondsRemaining={abandonment.secondsRemaining}
      />
    </div>
  );
};
