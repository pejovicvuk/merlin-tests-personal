const parentOrDepthTag: unique symbol = Symbol('parentOrDepth');
const childrenTag: unique symbol = Symbol('children');
const connectToParentTag: unique symbol = Symbol('connectToParent');

// Returns either the closest ancestor that is a HtmlControl, or the depth
// from the top of the DOM.
function getFirstHtmlControlAncestorOrDepth(el: HtmlControlCore): HtmlControlCore | number {
    let depth = 0;
    let parent = el.parentElement;

    while (parent !== null) {
        if (parent instanceof HtmlControlCore) return parent;
        parent = parent.parentElement;
        ++depth;
    }

    return depth;
}

const topLevelControlsPerDepth: (Set<HtmlControlCore> | undefined)[] = [];

function getNthAncestor(el: Element, n: number): Element | null {
    while (n-- > 0) {
        const parent = el.parentElement;
        if (parent === null) return null;
        else el = parent;
    }

    return el;
}

function disconnectChildrenAndSelfRecursively(control: HtmlControlCore) {
    const children = control[childrenTag];
    if (children !== undefined) {
        control[childrenTag] = undefined;
        for (const child of children) {
            disconnectChildrenAndSelfRecursively(child);
        }
    }

    control[parentOrDepthTag] = undefined;
    control.onDisconnectedFromDom();
}

function notifyAncestorsChangedRecursively(control: HtmlControlCore) {
    control.onAncestorsChanged();
    const children = control[childrenTag];
    if (children !== undefined) {
        for (const child of children) {
            notifyAncestorsChangedRecursively(child);
        }
    }
}

const emptyArray: readonly HtmlControlCore[] = [];

// Provides a base class for all custom HTMLElements in out library. Basically adds a consistent, synchronous view of the parent-child
// relationships between various controls by adding three methods and two getters:
//
// onConnectedToDom() - called when an element is attached to the DOM or when it's parent IHtmlControlCore has changed
// onDisconnectedFromDom() - called when an element is detached from the DOM
// onAncestorsChanged() - called when an element's chain of ancestors has changed
//
// get isPartOfDom - returns whether an element is part of the DOM
// get parentControl - returns the parent HtmlCoreControl if any
//
// The reason for this class is that, depending on the browser queue and when customElements.define is called, the parent HtmlControl
// may change while the page is loading. The above callbacks provide a consistent interface for getting the parent IHtmlControl.

export class HtmlControlCore extends HTMLElement {
    [parentOrDepthTag]?: HtmlControlCore | number; // closest ancestor HtmlControl or depth from the top of the DOM if none found. undefined if not connected
    [childrenTag]?: HtmlControlCore[];

    static connects = 0;
    static disconnects = 0;
    static ancestorChanges = 0;

    static get numAttached() {
        return this.connects - this.disconnects;
    }

    get isPartOfDom() {
        return this[parentOrDepthTag] !== undefined;
    }

    get parentControl(): HtmlControlCore | undefined {
        return typeof this[parentOrDepthTag] === 'object' ? this[parentOrDepthTag] : undefined;
    }

    onConnectedToDom(): void {
        ++HtmlControlCore.connects;
    }

    onDisconnectedFromDom(): void {
        ++HtmlControlCore.disconnects;
    }

    onAncestorsChanged(): void {
        ++HtmlControlCore.ancestorChanges;
    }

    get childControls(): readonly HtmlControlCore[] {
        return this.isPartOfDom && this[childrenTag] !== undefined ? this[childrenTag] : emptyArray;
    }

    [connectToParentTag](): HtmlControlCore | number {
        const parent = getFirstHtmlControlAncestorOrDepth(this);

        this[parentOrDepthTag] = parent;

        if (typeof parent === 'object') {
            if (parent[parentOrDepthTag] === undefined) parent[connectToParentTag]();

            if (parent[childrenTag] === undefined) parent[childrenTag] = [];
            parent[childrenTag].push(this);
        }
        else {
            let set = topLevelControlsPerDepth[parent];
            if (set === undefined) {
                set = new Set<HtmlControlCore>();
                topLevelControlsPerDepth[parent] = set;
            }
            set.add(this);
        }

        this.onConnectedToDom();

        return parent;
    }

    connectedCallback() {
        if (this[parentOrDepthTag] !== undefined) return;

        const parentOrDepth = this[connectToParentTag]();

        if (typeof parentOrDepth === 'object') {
            // in case we are between our parent and our children and we are only now getting the connectedCallback
            // (probably because our customElements.define was not called until now), see if any children currently attached to
            // the parent are actually our children and reconnect them here
            if (parentOrDepth[childrenTag] !== undefined) {
                let idx = parentOrDepth[childrenTag].length;
                while (idx > 0) {
                    const child: HtmlControlCore = parentOrDepth[childrenTag][--idx];

                    let search = child.parentElement!;
                    for (; ;) {
                        if (search === parentOrDepth) break;
                        else if (search === this) {
                            // remove the child from parent
                            const lastIdx = parentOrDepth[childrenTag].length - 1;
                            parentOrDepth[childrenTag][idx] = parentOrDepth[childrenTag][lastIdx];
                            parentOrDepth[childrenTag].splice(lastIdx, 1);

                            // add the child to us
                            if (this[childrenTag] === undefined) this[childrenTag] = [];
                            this[childrenTag].push(child);

                            child[parentOrDepthTag] = this;
                            notifyAncestorsChangedRecursively(child);

                            break;
                        }
                        else {
                            search = search.parentElement!;
                        }
                    }
                }
            }
        }
        else {
            // in case we are a top-level control that is only now getting the connectedCallback
            // (probably because our customElements.define was not called until now), see if there are any
            // top-level elements that are actually our children and adopt them

            for (let depth = parentOrDepth + 1; depth < topLevelControlsPerDepth.length; ++depth) {
                const set = topLevelControlsPerDepth[depth];
                if (set === undefined) continue;

                let childrenStart = this[childrenTag] === undefined ? 0 : this[childrenTag].length;
                for (const ctl of set) {
                    if (getNthAncestor(ctl, depth - parentOrDepth) !== this) continue;

                    if (this[childrenTag] === undefined) this[childrenTag] = [];
                    this[childrenTag].push(ctl);
                }

                if (this[childrenTag] !== undefined) {
                    for (let idx = childrenStart; idx < this[childrenTag].length; ++idx) {
                        const child = this[childrenTag][idx];
                        set.delete(child);
                        child[parentOrDepthTag] = this;
                        notifyAncestorsChangedRecursively(child);
                    }
                }
            }
        }
    }

    disconnectedCallback() {
        const parent = this[parentOrDepthTag];
        if (parent === undefined) return; // already disconnected by the parent control as it got the disconnectedCallback before us

        disconnectChildrenAndSelfRecursively(this);

        if (typeof parent === 'number') {
            topLevelControlsPerDepth[parent]!.delete(this);
        }
        else if (typeof parent === 'object' && parent[childrenTag] !== undefined) {
            const idx = parent[childrenTag].indexOf(this);
            if (idx >= 0) parent[childrenTag].splice(idx, 1);
        }
    }

    attributeChangedCallback(name: string, oldValue: string | null, newValue: string | null): void {
    }
}