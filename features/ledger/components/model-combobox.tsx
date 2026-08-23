"use client";

import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent } from "react";

type ModelComboboxProps = {
  models: string[];
  value: string;
  onChange: (value: string) => void;
};

export function ModelCombobox({ models, value, onChange }: ModelComboboxProps) {
  const listboxId = useId();
  const containerRef = useRef<HTMLDivElement>(null);
  const activeOptionRef = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);

  const options = useMemo(() => {
    const uniqueModels = [...new Set(models)];
    const query = value.trim().toLocaleLowerCase();
    if (!query || uniqueModels.some((model) => model.toLocaleLowerCase() === query)) {
      return uniqueModels;
    }
    return uniqueModels.filter((model) => model.toLocaleLowerCase().includes(query));
  }, [models, value]);
  const listOpen = open && options.length > 0;

  useEffect(() => {
    function closeOnOutsidePointer(event: PointerEvent) {
      if (!containerRef.current?.contains(event.target as Node)) setOpen(false);
    }

    document.addEventListener("pointerdown", closeOnOutsidePointer);
    return () => document.removeEventListener("pointerdown", closeOnOutsidePointer);
  }, []);

  useEffect(() => {
    if (listOpen) activeOptionRef.current?.scrollIntoView({ block: "nearest" });
  }, [activeIndex, listOpen]);

  function showOptions() {
    if (!options.length) return;
    const selectedIndex = options.indexOf(value);
    setActiveIndex(selectedIndex >= 0 ? selectedIndex : 0);
    setOpen(true);
  }

  function selectOption(model: string) {
    onChange(model);
    setOpen(false);
  }

  function handleKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === "Escape") {
      setOpen(false);
      return;
    }
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      if (!options.length) return;
      if (!listOpen) {
        showOptions();
        return;
      }
      const direction = event.key === "ArrowDown" ? 1 : -1;
      setActiveIndex((current) => (current + direction + options.length) % options.length);
      return;
    }
    if (event.key === "Enter" && listOpen && options[activeIndex]) {
      event.preventDefault();
      selectOption(options[activeIndex]);
    }
  }

  return (
    <div
      className={`model-combobox${listOpen ? " is-open" : ""}`}
      ref={containerRef}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setOpen(false);
      }}
    >
      <input
        id="ai-vision-model"
        role="combobox"
        aria-autocomplete="list"
        aria-controls={listboxId}
        aria-expanded={listOpen}
        aria-activedescendant={listOpen ? `${listboxId}-${activeIndex}` : undefined}
        autoComplete="off"
        value={value}
        onChange={(event) => {
          onChange(event.target.value);
          setActiveIndex(0);
          setOpen(true);
        }}
        onClick={showOptions}
        onFocus={showOptions}
        onKeyDown={handleKeyDown}
      />
      <span className="model-combobox-chevron" aria-hidden="true" />
      {listOpen ? (
        <div className="model-combobox-options" id={listboxId} role="listbox">
          {options.map((model, index) => (
            <button
              className={index === activeIndex ? "is-active" : undefined}
              id={`${listboxId}-${index}`}
              key={model}
              ref={index === activeIndex ? activeOptionRef : undefined}
              role="option"
              aria-selected={model === value}
              tabIndex={-1}
              type="button"
              onMouseDown={(event) => event.preventDefault()}
              onMouseEnter={() => setActiveIndex(index)}
              onClick={() => selectOption(model)}
            >
              <span>{model}</span>
              {model === value ? <span className="model-combobox-check">✓</span> : null}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}
