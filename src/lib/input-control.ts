import { setOrRemoveAttribute } from "./bindable-control.js";
import { addArrayListener, getTracker, removeArrayListener } from "./dependency-tracking.js";
import { HtmlControl, HtmlControlAmbientProperty } from "./html-control.js";

export abstract class InputControl extends HtmlControl implements HtmlControlAmbientProperty<'choices', Iterable<string | number | boolean | bigint> | undefined>{
    protected abstract get input(): HTMLInputElement;

    static override readonly bindableProperties = [...HtmlControl.bindableProperties, 'choices'];

    #choices?: Iterable<string | number | boolean | bigint>;
    #explicitChoices?: Iterable<string | number | boolean | bigint>;

    override onEnabledChanged() {
        try {
            setOrRemoveAttribute(this.input, 'disabled', this.enabled === false ? '' : null);
        }
        catch {
            this.input.removeAttribute('disabled');
        }
    }

    get choices(): Iterable<string | number | boolean | bigint> | undefined {
        try {
            return this.getProperty<Iterable<string | number | boolean | bigint>>('choices', this.#explicitChoices);
        }
        catch(err) {
            console.error(err);
            return undefined;
        }
    }

    set choices(val: Iterable<string | number | boolean | bigint> | undefined) {
        const prev = this.#explicitChoices;

        this.#explicitChoices = val;

        this.notifyPropertySetExplicitly('choices', prev, val);
    }

    get hasExplicitChoices() {
        return this.#explicitChoices !== undefined;
    }

    onChoicesChanged() {
        const choices = this.choices;

        if (choices === this.#choices) return;

        const input = this.input;

        if (this.#choices !== undefined) {
            if (Array.isArray(this.#choices)) {
                const tracker = getTracker(this.#choices);
                tracker?.[removeArrayListener](this.#onArrayChanged);
            }

            if (input.list !== null) input.list.innerHTML = '';
        }

        this.#choices = choices;

        if (this.#choices !== undefined) {
            if (Array.isArray(this.#choices)) {
                const tracker = getTracker(this.#choices);
                tracker?.[addArrayListener](this.#onArrayChanged);
            }

            let list = input.list;
            if (list == null) {
                list = document.createElement('datalist');
                list.id = 'data-list';
                this.shadowRoot!.appendChild(list);
                input.setAttribute('list', 'data-list');
            }

            for (const x of this.#choices) {
                const opt = document.createElement('option');
                opt.value = '' + x;
                list.appendChild(opt);
            }
        }
        else if (input.list != null) {
            input.list.remove();
            input.removeAttribute('list');
        }
    }

    #onArrayChanged = (arr: (string | number | boolean | bigint)[], index: number, inserted: number, deleted: number) => {
        const list = this.input.list;
        if (list === null) return;

        let same = Math.min(inserted, deleted);
        inserted -= same;
        deleted -= same;

        while(same-- > 0) {
            const item = arr[index];
            (list.children[index++] as HTMLOptionElement).value = '' + item;
        }

        while(inserted-- > 0) {
            const opt = document.createElement('option');
            opt.value = '' + arr[index];


            if (index < list.childElementCount) {
                list.insertBefore(opt, list.children[index]);
            }
            else {
                list.appendChild(opt);
            }

            ++index;
        }

        while(deleted > 0) {
            const opt = list.children[index + --deleted];
            opt.remove();
        }
    }

    override onDisconnectedFromDom(): void {
        super.onDisconnectedFromDom();
        this.onChoicesChanged();
    }
}

