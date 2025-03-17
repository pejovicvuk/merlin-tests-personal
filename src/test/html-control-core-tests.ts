import { createNewElementName, getNestedHtmlElements, postEvent, ensureEventOfType } from './unit-test-interfaces.js'
import { HtmlControlCore } from '../lib/html-control-core.js'

class HtmlControlWithEventTracking extends HtmlControlCore {
    override onConnectedToDom(): void {
        postEvent(this, 'connected');
    }

    override onDisconnectedFromDom(): void {
        postEvent(this, 'disconnected');
    }

    override onAncestorsChanged(): void {
        postEvent(this, 'ancestors');
    }
}

export function registerParentAndChild(playground: HTMLDivElement) {
    const parent = createNewElementName();
    const child = createNewElementName()

    playground.innerHTML = getNestedHtmlElements(parent, child);

    const parentClass = class extends HtmlControlWithEventTracking {};
    const childClass = class extends HtmlControlWithEventTracking {};

    customElements.define(parent, parentClass);
    customElements.define(child, childClass);

    ensureEventOfType(parentClass, 'connected');
    ensureEventOfType(childClass, 'connected');

    playground.innerHTML = '';

    ensureEventOfType(childClass, 'disconnected');
    ensureEventOfType(parentClass, 'disconnected');

    return undefined;
}

export function registerParentThenChild(playground: HTMLDivElement) {
    const parent = createNewElementName();
    const child = createNewElementName()

    playground.innerHTML = getNestedHtmlElements(parent, child);

    const parentClass = class extends HtmlControlWithEventTracking {};
    const childClass = class extends HtmlControlWithEventTracking {};

    customElements.define(parent, parentClass);

    ensureEventOfType(parentClass, 'connected');
    customElements.define(child, childClass);
    ensureEventOfType(childClass, 'connected');

    playground.innerHTML = '';

    ensureEventOfType(childClass, 'disconnected');
    ensureEventOfType(parentClass, 'disconnected');

    return undefined;
}

export function registerChildThenParent(playground: HTMLDivElement) {
    const parent = createNewElementName();
    const child = createNewElementName()

    playground.innerHTML = getNestedHtmlElements(parent, child);

    const parentClass = class extends HtmlControlWithEventTracking {};
    const childClass = class extends HtmlControlWithEventTracking {};

    customElements.define(child, childClass);
    ensureEventOfType(childClass, 'connected');
    customElements.define(parent, parentClass);
    ensureEventOfType(parentClass, 'connected');
    ensureEventOfType(childClass, 'ancestors');

    playground.innerHTML = '';

    ensureEventOfType(childClass, 'disconnected');
    ensureEventOfType(parentClass, 'disconnected');

    return undefined;
}

export function registerGrandparentAndChildThenParent(playground: HTMLDivElement) {
    const grandparent = createNewElementName();
    const parent = createNewElementName();
    const child = createNewElementName()

    playground.innerHTML = getNestedHtmlElements(grandparent, parent, child);

    const grandparentClass = class extends HtmlControlWithEventTracking {};
    const parentClass = class extends HtmlControlWithEventTracking {};
    const childClass = class extends HtmlControlWithEventTracking {};
    
    customElements.define(grandparent, grandparentClass);
    customElements.define(child, childClass);

    ensureEventOfType(grandparentClass, 'connected');
    ensureEventOfType(childClass, 'connected');
    
    customElements.define(parent, parentClass);
    ensureEventOfType(parentClass, 'connected');
    ensureEventOfType(childClass, 'ancestors');

    playground.innerHTML = '';

    ensureEventOfType(childClass, 'disconnected');
    ensureEventOfType(parentClass, 'disconnected');
    ensureEventOfType(grandparentClass, 'disconnected');

    return undefined;
}
