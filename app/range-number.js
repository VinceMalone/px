class RangeNumber extends HTMLInputElement {
  static get observedAttributes() {
    return ['for'];
  }

  #twin;
  #twinObserver = new MutationObserver((mutations) => {
    for (const mutation of mutations) {
      switch (mutation.type) {
        case 'attributes':
          const { attributeName } = mutation;
          this[attributeName] = mutation.target[attributeName];
      }
    }
  });

  constructor() {
    super();
    this.type = 'number';
    this.required = true;
  }

  connectedCallback() {
    this.addEventListener('input', this.#onInput);
    this.addEventListener('blur', this.#onBlur);
  }

  disconnectedCallback() {
    this.#unsubscribeFromTwin();
  }

  attributeChangedCallback(name) {
    switch (name) {
      case 'for':
        this.#subscribeToTwin();
    }
  }

  #subscribeToTwin() {
    if (this.#twin) {
      this.#unsubscribeFromTwin();
    }

    this.#twin = document.querySelector(`#${this.for}`);

    if (!this.#twin) {
      this.disabled = true;
      throw new Error(
        `a paired input with the name "${this.for}" could not be found`,
      );
    }

    this.max = this.#twin.max;
    this.min = this.#twin.min;
    this.step = this.#twin.step;
    this.value = this.#twin.value;

    this.#twinObserver.observe(this.#twin, {
      attributeFilter: ['max', 'min', 'step'],
    });

    this.#twin.addEventListener('input', this.#onTwinInput);
  }

  #unsubscribeFromTwin() {
    this.#twinObserver.disconnect();
    this.#twin.removeEventListener('input', this.#onTwinInput);
  }

  #onTwinInput = (event) => {
    this.value = event.target.value;
  };

  #onInput = (event) => {
    if (this.validity.valid && event.target.value !== this.#twin.value) {
      this.#twin.value = event.target.value;
      this.#twin.dispatchEvent(new InputEvent('input'));
    }
  };

  #onBlur = () => {
    if (!this.validity.valid) {
      this.value = this.#twin.value;
    }
  };

  get for() {
    return this.getAttribute('for');
  }

  set for(value) {
    if (value) {
      this.setAttribute('for', value);
    } else {
      this.removeAttribute('for');
    }
  }
}

window.customElements.define('range-number', RangeNumber, {
  extends: 'input',
});
