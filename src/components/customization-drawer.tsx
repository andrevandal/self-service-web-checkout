import { useEffect, useRef, useState, type KeyboardEvent, type RefObject } from "react";
import type { CartAddonSelection, CartLineInput, CartVariantSelection } from "#/lib/cart";
import type { MenuProduct } from "#/lib/catalog.functions";

export type CustomizationDrawerProps = {
  product: MenuProduct;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onAdd: (item: CartLineInput) => void;
  returnFocusRef: RefObject<HTMLButtonElement | null>;
};

type SelectionState = Record<string, string[]>;

const getGroupSelection = (selection: SelectionState, groupId: string): string[] =>
  selection[groupId] ?? [];

const groupIsValid = (minimum: number, maximum: number | null, count: number): boolean =>
  count >= minimum && (maximum === null || count <= maximum);

export const CustomizationDrawer = ({
  product,
  open,
  onOpenChange,
  onAdd,
  returnFocusRef,
}: CustomizationDrawerProps) => {
  const [selection, setSelection] = useState<SelectionState>({});
  const [validationMessage, setValidationMessage] = useState<string | null>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const sheetRef = useRef<HTMLDivElement>(null);
  const hadFocusRef = useRef(false);

  useEffect(() => {
    if (open) {
      setSelection({});
      setValidationMessage(null);
      hadFocusRef.current = true;
      closeRef.current?.focus();
      return;
    }

    if (hadFocusRef.current) {
      hadFocusRef.current = false;
      returnFocusRef.current?.focus();
    }
  }, [open, product.id, returnFocusRef]);

  if (!open) {
    return null;
  }

  const allGroups = [...product.variantGroups, ...product.addonGroups];
  const invalidGroup = allGroups.find((group) => {
    const count = getGroupSelection(selection, group.id).length;
    return !groupIsValid(group.minSelections, group.maxSelections, count);
  });

  const toggleSelection = (
    groupId: string,
    optionId: string,
    maximum: number | null,
    single: boolean,
  ) => {
    setValidationMessage(null);
    setSelection((current) => {
      const selected = getGroupSelection(current, groupId);
      if (single) {
        return { ...current, [groupId]: [optionId] };
      }

      if (selected.includes(optionId)) {
        return { ...current, [groupId]: selected.filter((id) => id !== optionId) };
      }

      if (maximum !== null && selected.length >= maximum) {
        return current;
      }
      return { ...current, [groupId]: [...selected, optionId] };
    });
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === "Escape") {
      event.preventDefault();
      onOpenChange(false);
      return;
    }

    if (event.key !== "Tab") {
      return;
    }
    const focusable = Array.from(
      sheetRef.current?.querySelectorAll<HTMLElement>(
        'button:not([disabled]), input:not([disabled]), [href], select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
      ) ?? [],
    );
    if (focusable.length === 0) {
      return;
    }
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (!first || !last) {
      return;
    }
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  };

  const handleSubmit = () => {
    if (invalidGroup) {
      setValidationMessage(
        `Choose at least ${invalidGroup.minSelections} option in ${invalidGroup.name}.`,
      );
      return;
    }

    const variants: CartVariantSelection[] = product.variantGroups.flatMap((group) => {
      const selectedIds = getGroupSelection(selection, group.id);
      return selectedIds.flatMap((optionId) => {
        const option = group.options.find((candidate) => candidate.id === optionId);
        return option
          ? [
              {
                groupId: group.id,
                groupName: group.name,
                optionId: option.id,
                optionName: option.name,
                priceDeltaCents: option.priceDeltaCents,
              },
            ]
          : [];
      });
    });
    const addons: CartAddonSelection[] = product.addonGroups.flatMap((group) => {
      const selectedIds = getGroupSelection(selection, group.id);
      return selectedIds.flatMap((addonId) => {
        const addon = group.addons.find((candidate) => candidate.id === addonId);
        return addon
          ? [
              {
                groupId: group.id,
                groupName: group.name,
                addonId: addon.id,
                addonName: addon.name,
                priceDeltaCents: addon.priceDeltaCents,
              },
            ]
          : [];
      });
    });

    onAdd({
      productId: product.id,
      categoryId: product.categoryId,
      productName: product.name,
      basePriceCents: product.basePriceCents,
      variants,
      addons,
    });
    onOpenChange(false);
  };

  return (
    <div
      aria-hidden={!open}
      className="fixed inset-0 z-50 flex items-end bg-foreground/45"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) {
          onOpenChange(false);
        }
      }}
    >
      <div
        aria-labelledby="customization-title"
        aria-modal="true"
        className="max-h-[90dvh] w-full overflow-y-auto rounded-t-xl bg-card p-6 shadow-lg"
        onKeyDown={handleKeyDown}
        ref={sheetRef}
        role="dialog"
      >
        <div className="mx-auto flex w-full max-w-2xl flex-col gap-6">
          <div className="flex items-start justify-between gap-4">
            <div>
              <p className="text-body-s font-medium text-muted-foreground">Customize your order</p>
              <h2 className="mt-1 text-heading-l font-bold" id="customization-title">
                Customize {product.name}
              </h2>
              <p className="mt-1 text-body-m text-muted-foreground">
                Starting at {formatCents(product.basePriceCents)}
              </p>
            </div>
            <button
              aria-label="Close customization"
              className="inline-flex min-h-12 min-w-12 items-center justify-center rounded-pill border border-border text-heading-m transition-transform duration-150 hover:bg-secondary active:scale-[0.97] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
              onClick={() => onOpenChange(false)}
              ref={closeRef}
              type="button"
            >
              ×
            </button>
          </div>

          <div className="flex flex-col gap-5">
            {product.variantGroups.map((group) => (
              <fieldset className="flex flex-col gap-3" key={group.id}>
                <legend className="text-heading-s font-semibold">{group.name}</legend>
                <div className="grid gap-3 sm:grid-cols-2">
                  {group.options.map((option) => (
                    <label
                      className="flex min-h-12 cursor-pointer items-center gap-3 rounded-md border border-border px-4 py-3 has-[:checked]:border-2 has-[:checked]:border-primary has-[:checked]:bg-secondary"
                      key={option.id}
                    >
                      <input
                        aria-label={`${option.name}${option.priceDeltaCents ? `, ${formatDelta(option.priceDeltaCents)}` : ""}`}
                        checked={getGroupSelection(selection, group.id).includes(option.id)}
                        className="size-5 accent-primary"
                        name={group.id}
                        onChange={() =>
                          toggleSelection(group.id, option.id, group.maxSelections, true)
                        }
                        type="radio"
                      />
                      <span className="flex-1 text-body-m font-medium">{option.name}</span>
                      {option.priceDeltaCents !== 0 && (
                        <span className="text-body-s text-muted-foreground">
                          {formatDelta(option.priceDeltaCents)}
                        </span>
                      )}
                    </label>
                  ))}
                </div>
              </fieldset>
            ))}

            {product.addonGroups.map((group) => (
              <fieldset className="flex flex-col gap-3" key={group.id}>
                <legend className="text-heading-s font-semibold">
                  {group.name}
                  <span className="ml-2 text-body-s font-normal text-muted-foreground">
                    {group.minSelections === 0
                      ? "Optional"
                      : `Choose at least ${group.minSelections}`}
                  </span>
                </legend>
                <div className="grid gap-3 sm:grid-cols-2">
                  {group.addons.map((addon) => {
                    const selected = getGroupSelection(selection, group.id).includes(addon.id);
                    const maxReached =
                      group.maxSelections !== null &&
                      getGroupSelection(selection, group.id).length >= group.maxSelections;
                    return (
                      <label
                        className="flex min-h-12 cursor-pointer items-center gap-3 rounded-md border border-border px-4 py-3 has-[:checked]:border-2 has-[:checked]:border-primary has-[:checked]:bg-secondary"
                        key={addon.id}
                      >
                        <input
                          aria-label={`${addon.name}, ${formatDelta(addon.priceDeltaCents)}`}
                          checked={selected}
                          className="size-5 accent-primary"
                          disabled={!selected && maxReached}
                          onChange={() =>
                            toggleSelection(group.id, addon.id, group.maxSelections, false)
                          }
                          type="checkbox"
                        />
                        <span className="flex-1 text-body-m font-medium">{addon.name}</span>
                        <span className="text-body-s text-muted-foreground">
                          {formatDelta(addon.priceDeltaCents)}
                        </span>
                      </label>
                    );
                  })}
                </div>
              </fieldset>
            ))}
          </div>

          {(validationMessage || invalidGroup) && (
            <p
              aria-live="polite"
              className="rounded-md bg-destructive/10 px-4 py-3 text-body-s text-destructive"
            >
              {validationMessage ??
                `Choose at least ${invalidGroup?.minSelections ?? 1} option in ${invalidGroup?.name ?? "each group"}.`}
            </p>
          )}

          <button
            className="min-h-12 w-full rounded-pill bg-primary px-6 py-3 font-semibold text-primary-foreground transition-transform duration-150 active:scale-[0.97] disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
            disabled={Boolean(invalidGroup)}
            onClick={handleSubmit}
            type="button"
          >
            Add to order
          </button>
        </div>
      </div>
    </div>
  );
};

const formatCents = (cents: number): string =>
  new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(cents / 100);

const formatDelta = (cents: number): string => {
  const sign = cents > 0 ? "+" : "−";
  return `${sign}${formatCents(Math.abs(cents))}`;
};
