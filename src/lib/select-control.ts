import { setOrRemoveAttribute } from "./bindable-control.js";
import { addArrayListener, addListener, getTracker, removeArrayListener, removeListener } from "./dependency-tracking.js";
import { HtmlControl, HtmlControlAmbientProperty } from "./html-control.js";

type SelectControlObjectItem = { id: string, text: string };
export type SelectControlItem = string | number | boolean | bigint | undefined | SelectControlObjectItem;

export class SelectControl extends HtmlControl implements
    HtmlControlAmbientProperty<'items', Iterable<SelectControlItem>>, HtmlControlAmbientProperty<'selectedIndex', number> {
    static override ambientProperties = [...HtmlControl.ambientProperties, 'items', 'selectedIndex'];

    #displayedItems?: Iterable<SelectControlItem>;
    #itemToElement?: Map<SelectControlObjectItem, HTMLOptionElement>;
    #elementToItem?: Map<HTMLOptionElement, SelectControlObjectItem>;
    #explicitItems?: Iterable<SelectControlItem>;
    #explicitSelectedIndex?: number;

    constructor() {
        super();
        const shadow = this.attachShadow({ mode: 'open' });
        shadow.innerHTML = '<select part="select"></select>';

        this.#select.addEventListener('change', SelectControl.#onChange);
    }

    get #select(): HTMLSelectElement {
        return this.shadowRoot!.querySelector('select') as HTMLSelectElement;
    }

    override onEnabledChanged() {
        try {
            setOrRemoveAttribute(this.#select, 'disabled', this.enabled === false ? '' : null);
        }
        catch {
            this.#select.removeAttribute('disabled');
        }
    }

    get items() {
        return this.getProperty<Iterable<SelectControlItem> | undefined>('items', this.#explicitItems);
    }

    set items(value: Iterable<SelectControlItem> | undefined) {
        const prev = this.#explicitItems;

        this.#explicitItems = value;

        this.notifyPropertySetExplicitly('items', prev, value);
    }

    get hasExplicitItems() {
        return this.#explicitItems !== undefined;
    }

    onItemsChanged() {
        let items: Iterable<SelectControlItem> | undefined;
        try {
            items = this.items;
        }
        catch {
            items = undefined;
        }

        if (items === this.#displayedItems) return;

        if (Array.isArray(this.#displayedItems)) {
            const tracker = getTracker(this.#displayedItems);
            tracker?.[removeArrayListener](this.#onArrayChanged);
        }

        if (this.#itemToElement !== undefined) {
            for (const item of this.#itemToElement.keys()) {
                const tracker = getTracker(item)!;
                tracker[removeListener](this.#onItemChanged, 'id', item);
                tracker[removeListener](this.#onItemChanged, 'text', item);
            }

            this.#itemToElement.clear();
            this.#elementToItem!.clear();
        }

        const select = this.#select;
        select.innerHTML = '';

        this.#displayedItems = items;

        if (items !== undefined) {
            if (Array.isArray(this.#displayedItems)) {
                const tracker = getTracker(this.#displayedItems);
                if (tracker !== undefined) {
                    tracker[addArrayListener](this.#onArrayChanged);
                }
            }

            for (const item of items) {
                const opt = document.createElement('option');
                if (typeof item !== 'object') {
                    opt.value = '' + item;
                    opt.textContent = '' + item;
                }
                else {
                    opt.value = item.id;
                    opt.textContent = item.text;

                    const tracker = getTracker<SelectControlObjectItem>(item);
                    if (tracker !== undefined) {
                        if (this.#itemToElement === undefined) {
                            this.#itemToElement = new Map();
                            this.#elementToItem = new Map();
                        }

                        this.#itemToElement.set(item, opt);
                        this.#elementToItem!.set(opt, item);

                        tracker[addListener](SelectControl.#onItemChangedShared, 'id', this);
                        tracker[addListener](SelectControl.#onItemChangedShared, 'text', this);
                    }
                }

                select.appendChild(opt);
            }
        }

        this.#updateSelectIndex();
    }

    static #onItemChangedShared(item: SelectControlObjectItem, ctl: SelectControl) {
        ctl.#onItemChanged(item);
    }

    #onItemChanged(item: SelectControlObjectItem) {
        const opt = this.#itemToElement!.get(item)!;
        opt.value = item.id;
        opt.textContent = item.text;
    }

    #onArrayChanged = (arr: SelectControlItem[], index: number, inserted: number, deleted: number) => {
        const select = this.#select;

        let same = Math.min(inserted, deleted);
        inserted -= same;
        deleted -= same;

        while(same-- > 0) {
            const opt = select.children[index] as HTMLOptionElement;
            const item = arr[index];
            const prev = this.#elementToItem?.get(opt);

            if (prev !== item) {
                const prevTracker = prev !== undefined ? getTracker(prev) : undefined;
                if (prevTracker !== undefined) {
                    this.#itemToElement!.delete(prev!);
                    this.#elementToItem!.delete(opt);
    
                    prevTracker[removeListener](SelectControl.#onItemChangedShared, 'id', this);
                    prevTracker[removeListener](SelectControl.#onItemChangedShared, 'text', this);
                }

                if (typeof item === 'object') {
                    const tracker = getTracker(item);
                    if (tracker !== undefined) {
                        tracker[addListener](SelectControl.#onItemChangedShared, 'id', this);
                        tracker[addListener](SelectControl.#onItemChangedShared, 'text', this);

                        if (this.#itemToElement === undefined) {
                            this.#itemToElement = new Map();
                            this.#elementToItem = new Map();
                        }

                        this.#itemToElement.set(item, opt);
                        this.#elementToItem!.set(opt, item);
                    }
                }

                opt.value = typeof item !== 'object' ? '' + item : item.id;
                opt.text = typeof item !== 'object' ? '' + item : item.text;
            }

            ++index;
        }

        while(inserted-- > 0) {
            const opt = document.createElement('option');
            const item = arr[index];
            if (typeof item !== 'object') {
                opt.value = '' + item;
                opt.textContent = '' + item;
            }
            else {
                opt.value = item.id;
                opt.textContent = item.text;

                const tracker = getTracker(item);
                if (tracker !== undefined) {
                    this.#itemToElement ??= new Map();
                    this.#itemToElement.set(item, opt);
                    tracker[addListener](this.#onItemChanged, 'id', item);
                    tracker[addListener](this.#onItemChanged, 'text', item);
                }
            }

            if (index < select.childElementCount) {
                select.insertBefore(opt, select.children[index++]);
            }
            else {
                select.appendChild(opt);
            }
        }

        while(deleted > 0) {
            const opt = select.children[index + --deleted] as HTMLOptionElement;
            opt.remove();

            if (this.#elementToItem !== undefined) {
                const item = this.#elementToItem.get(opt);
                if (item !== undefined) {
                    const tracker = getTracker(item)!;
                    this.#itemToElement!.delete(item);
                    this.#elementToItem!.delete(opt);
    
                    tracker[removeListener](SelectControl.#onItemChangedShared, 'id', this);
                    tracker[removeListener](SelectControl.#onItemChangedShared, 'text', this);
                }
            }
        }

        this.#updateSelectIndex();
    };

    override onDisconnectedFromDom(): void {
        super.onDisconnectedFromDom();
        this.onItemsChanged();
    }

    get selectedIndex() {
        try {
            return this.getProperty<number>('selectedIndex', this.#explicitSelectedIndex);
        }
        catch {
            return undefined;
        }
    }

    set selectedIndex(val: number | undefined) {
        const prev = this.#explicitSelectedIndex;
        this.#explicitSelectedIndex = val;
        this.notifyPropertySetExplicitly('selectedIndex', prev, val);
    }

    get hasExplicitSelectedIndex() {
        return this.#explicitSelectedIndex !== undefined;
    }

    #updateSelectIndex() {
        const select = this.#select;

        const idx = this.selectedIndex;
        if (idx !== undefined && 0 <= idx && idx < select.children.length) {
            select.selectedIndex = idx;
        }
        else {
            select.selectedIndex = -1;
        }
    }

    onSelectedIndexChanged() {
        this.#updateSelectIndex();
    }

    #onChangeImpl() {
        const idx = this.#select.selectedIndex;
        this.writeToBindingSource('selectedIndex', idx >= 0 ? idx : undefined);
    }

    static #onChange(ev: Event) {
        ((((ev.currentTarget as Element).parentNode) as ShadowRoot).host as SelectControl).#onChangeImpl();
    }
}

