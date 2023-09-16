
const CLASSES = {
  BASE: "combobox",
  CONTAINER: "combobox-container",
  INPUT: "combobox-input",
  LABEL: "combobox-label",
  ARROW_ICON: "combobox-arrow-icon",
  RESULTS: {
    BASE: "combobox-results",
    VISIBLE: "combobox-results-isVisible",
  },
  RESULT: {
    BASE: "combobox-result",
    HIDDEN: "hidden",
    FOCUS: "combobox-result-isFocused",
  },
  NOTICE: "combobox-notice",
  SELECT_RESULT: "combobox-select-result",
  LIST: "combobox-list",
};

const KEY_CODES = {
  ENTER: "Enter",
  ESC: "Escape",
  UP: "ArrowUp",
  DOWN: "ArrowDown",
};

interface ComboboxOption {
  label: string;
  value: string;
  id: string;
  element?: HTMLLIElement;
}

export class Combobox {
  private readonly container: HTMLDivElement;
  private readonly input: HTMLInputElement;
  private readonly optionList: HTMLUListElement;
  private readonly resultsNotice: HTMLDivElement;
  private readonly select: HTMLSelectElement;

  private isVisible: boolean = false;
  private optionsAll: ComboboxOption[] = [];
  private optionsFiltered: ComboboxOption[] = [];
  private optionUpdateRunning: boolean = false;
  private optionUpdateRequired: boolean = false;

  constructor(node: HTMLSelectElement) {
    this.select = node;
    this.select.style.display = "none";
    this.container = document.createElement("div");
    this.select.parentNode?.insertBefore(this.container, this.select);
    this.container.appendChild(this.select);
    this.select.classList.forEach((c) => this.container.classList.add(c));
    this.container.classList.add(CLASSES.CONTAINER);
    this.container.style.position = "relative";
    const resultsId = `${this.select.id}-combobox`;

    // Create input element
    let labelText = "";
    if (this.select.id.length > 0) {
      const label = this.container.querySelector(`label[for="${this.select.id}"]`);
      labelText = label?.textContent ?? "";
    }
    this.input = document.createElement("input");
    this.input.type = "text";
    this.input.setAttribute("role", "combobox");
    this.input.setAttribute("aria-label", `Search and select an option for ${labelText}`);
    this.input.setAttribute("aria-expanded", "false");
    this.input.setAttribute("aria-autocomplete", "list");
    this.input.setAttribute("aria-owns", resultsId);
    this.input.classList.add(CLASSES.INPUT);
    this.container.appendChild(this.input);

    // Create arrow icon element
    const icon = document.createElement("span");
    icon.classList.add(CLASSES.ARROW_ICON, "codicon", "codicon-chevron-down");
    this.container.appendChild(icon);

    // Create option element
    this.optionList = document.createElement("ul");
    this.optionList.classList.add(CLASSES.RESULTS.BASE);
    this.optionList.setAttribute("id", resultsId);
    this.optionList.setAttribute("role", "listbox");
    this.container.appendChild(this.optionList);

    // Create dropdown container
    this.resultsNotice = document.createElement("div");
    this.resultsNotice.classList.add(CLASSES.NOTICE);
    this.resultsNotice.setAttribute("role", "status");
    this.resultsNotice.setAttribute("aria-live", "polite");
    this.container.appendChild(this.resultsNotice);

    // Load options
    const observer = new MutationObserver((mutationsList: MutationRecord[]) => {
      const hasUpdates = mutationsList.some((mutation: MutationRecord) => {
        let hasUpdates = false;
        if (mutation.type === "childList" && mutation.addedNodes.length > 0) {
          mutation.addedNodes.forEach((node: Node) => {
            if (!hasUpdates && node instanceof HTMLOptionElement) {
              hasUpdates = true;
            }
          });
        }
        if (!hasUpdates && mutation.type === "childList" && mutation.removedNodes.length > 0) {
          mutation.removedNodes.forEach((node: Node) => {
            if (!hasUpdates && node instanceof HTMLOptionElement) {
              hasUpdates = true;
            }
          });
        }
        return hasUpdates;
      });
      if (hasUpdates) {
        this.updateOptionElements();
      }
    });
    observer.observe(this.select, { childList: true });

    this.updateOptionElements();

    // Add listeners
    this.select.addEventListener("change", () => { this.setSelectValue(); });
    this.input.addEventListener("input", () => { this.filterResults(this.input.value); });
    this.input.addEventListener("focus", () => { this.showResults(); });
    this.input.addEventListener("blur", () => { this.hideResults(); this.setSelectValue(); });

    document.body.addEventListener("click", (event: MouseEvent) => {
      if (event.target instanceof Node && !this.container.contains(event.target)) {
        this.hideResults();
      }
    });

    document.addEventListener("keydown", (event: KeyboardEvent) => { this.keydownEvent(event); });
  }

  private setSelectValue() {
    const selectedOption = this.optionsAll.find((o) => o.value === this.select.value);
    if (selectedOption !== undefined && this.input.value !== selectedOption.label) {
      this.input.dataset.selected = selectedOption.id;
      this.pickOption();
    } else {
      this.input.value = this.select.value;
    }
  }

  private updateOptionElements() {
    if (this.optionUpdateRunning) {
      this.optionUpdateRequired = true;
    } else {
      this.optionUpdateRunning = true;
      this.optionUpdateRequired = false;
      this.removeOptionElements();
      const selectOptions = [].slice.call(this.select.querySelectorAll("option"));
      this.optionsAll = selectOptions.map((option: HTMLOptionElement, index: number) => {
        return {
          label: option.textContent ?? "",
          value: option.value,
          id: `${this.select.id}-combobox-result-${index}`,
        };
      });
      this.createOptionElements();
      this.filterResults(this.input.value);
      this.setSelectValue();
      this.optionUpdateRunning = false;
      if (this.optionUpdateRequired) {
        this.updateOptionElements();
      }
    }
  }

  private clearOptionFocus() {
    const focused = this.optionList.querySelector(`.${CLASSES.RESULT.FOCUS}`);
    // eslint-disable-next-line no-null/no-null
    if (focused !== null) {
      focused.classList.remove(CLASSES.RESULT.FOCUS);
    }
  }

  private focusPreviousOption() {
    let optionIndex = 0;
    if (this.optionsFiltered.length < 1) {
      return;
    } else if (this.optionsFiltered.length > 1) {
      const focusedElement = this.optionList.querySelector(`.${CLASSES.RESULT.FOCUS}`);
      const option = this.optionsFiltered.find((o) => o.id === focusedElement?.id);
      optionIndex = this.optionsFiltered.length - 1;
      if (option !== undefined) {
        optionIndex = this.optionsFiltered.indexOf(option) - 1;
      }
      if (optionIndex < 0 || optionIndex >= this.optionsFiltered.length) {
        optionIndex = this.optionsFiltered.length - 1;
      }
    }
    this.focusOption(this.optionsFiltered[optionIndex]);
  }

  private focusNextOption() {
    let optionIndex = 0;
    if (this.optionsFiltered.length < 1) {
      return;
    } else if (this.optionsFiltered.length > 1) {
      const selected = this.optionList.querySelector(`.${CLASSES.RESULT.FOCUS}`);
      const option = this.optionsFiltered.find((o) => o.id === selected?.id);
      optionIndex = this.optionsFiltered.length + 1;
      if (option !== undefined) {
        optionIndex = this.optionsFiltered.indexOf(option) + 1;
      }
      if (optionIndex < 0 || optionIndex >= this.optionsFiltered.length) {
        optionIndex = 0;
      }
    }
    this.focusOption(this.optionsFiltered[optionIndex]);
  }

  private focusOption(option: ComboboxOption, callback?: () => void) {
    const optionNode = option.element;
    if (optionNode !== undefined) {
      this.clearOptionFocus();
      optionNode.classList.add(CLASSES.RESULT.FOCUS);
      this.input.dataset.selected = optionNode.id;
      optionNode.scrollIntoView(false);
      this.resultsNotice.textContent = optionNode.textContent;
      if (callback !== undefined) {
        callback();
      }
    }
  }

  private pickOption() {
    if (this.input.dataset.selected === undefined) {
      return;
    }
    const selectedOption = this.optionsAll.find((o) => o.id === this.input.dataset.selected);
    if (selectedOption === undefined) {
      return;
    }
    this.input.value = selectedOption.label;
    this.select.value = selectedOption.value;
    this.resultsNotice.textContent = `${selectedOption.label} selected`;
    this.select.dispatchEvent(new Event("change"));
    this.input.blur();
  }

  private filterResults(input: string) {
    input = input.toLowerCase();
    this.optionsFiltered = this.optionsAll.filter((option: ComboboxOption) => {
      const searchTerms = input.toLowerCase().split(" ");
      const labelLowerCase = option.label.toLowerCase();
      const valueLowerCase = option.value.toLowerCase();
      const isMatch = searchTerms.every(term =>
        labelLowerCase.includes(term) || valueLowerCase.includes(term)
      );
      if (isMatch) {
        option.element?.classList.remove(CLASSES.RESULT.HIDDEN);
        return true;
      }
      option.element?.classList.add(CLASSES.RESULT.HIDDEN);
      option.element?.classList.remove(CLASSES.RESULT.FOCUS);
      return false;
    });
  }

  private createOptionElements() {
    if (this.optionsAll.length > 0) {
      this.optionsAll.forEach((option) => {
        const resultListItem = document.createElement("li");
        option.element = resultListItem;
        resultListItem.setAttribute("id", option.id);
        resultListItem.classList.add(CLASSES.RESULT.BASE);
        resultListItem.textContent = option.label;
        resultListItem.dataset.value = option.value;
        resultListItem.setAttribute("role", "option");
        // On click, the elements are already invisible and thus the click event gets suppressed, use mousedown instead
        resultListItem.addEventListener("mousedown", () => {
          this.focusOption(option, () => this.pickOption());
        });
        this.optionList.appendChild(resultListItem);
      });
    } else {
      const noResultsItem = document.createElement("li");
      noResultsItem.classList.add(CLASSES.RESULT.BASE);
      noResultsItem.textContent = "No results found";
      this.optionList.appendChild(noResultsItem);
    }
  }

  private removeOptionElements() {
    this.optionList.replaceChildren();
    this.optionsAll = [];
    this.optionsFiltered = [];
  }

  private showResults() {
    this.isVisible = true;
    this.filterResults("");
    this.input.setSelectionRange(0, this.input.value.length);
    this.optionList.classList.add(CLASSES.RESULTS.VISIBLE);
    this.input.setAttribute("aria-expanded", "true");
    if (this.optionsAll.length === 0) {
      this.resultsNotice.textContent = "No results found";
    } else if (this.optionsAll.length === 1) {
      this.resultsNotice.textContent = "1 result";
    } else {
      this.resultsNotice.textContent = `${this.optionsAll.length} results`;
    }
  }

  private hideResults() {
    this.isVisible = false;
    this.optionList.classList.remove(CLASSES.RESULTS.VISIBLE);
    this.input.setAttribute("aria-expanded", "false");
  }

  private keydownEvent(event: KeyboardEvent) {
    if (!(event.target instanceof Node) || !this.container.contains(event.target)) {
      return;
    }
    switch (event.key) {
      case KEY_CODES.ENTER:
        this.pickOption();
        break;
      case KEY_CODES.ESC:
        this.input.blur();
        break;
      case KEY_CODES.DOWN:
        if (!this.isVisible) {
          this.showResults();
        } else {
          this.focusNextOption();
        }
        event.preventDefault();
        break;
      case KEY_CODES.UP:
        this.focusPreviousOption();
        event.preventDefault();
        break;
    }
  }
}
