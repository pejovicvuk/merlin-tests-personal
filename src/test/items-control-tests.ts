import { sleepAsync, toTracked, HtmlControl } from '../lib/index.js';
import '../lib/index.js';


class TextModel {
    setupResizableContainer = () => {
        const itemsControl = document.querySelector('items-control');
        if (!itemsControl) return;
        
        // Get the container div inside the shadow DOM
        const container = itemsControl.shadowRoot?.querySelector('div[part="container"]') as HTMLElement;
        if (!container) return;
        
        // Style the container to indicate it's resizable
        container.style.resize = 'both';
        container.style.overflow = 'auto';
        container.style.border = '2px dashed #007bff';
        container.style.position = 'relative';
        
        // Add a resize handle indicator
        const resizeHandle = document.createElement('div');
        resizeHandle.style.position = 'absolute';
        resizeHandle.style.bottom = '0';
        resizeHandle.style.right = '0';
        resizeHandle.style.width = '20px';
        resizeHandle.style.height = '20px';
        resizeHandle.style.cursor = 'nwse-resize';
        resizeHandle.style.background = 'linear-gradient(135deg, transparent 50%, #007bff 50%)';
        container.appendChild(resizeHandle);
        
        // Add a label to show current dimensions
        const dimensionsLabel = document.createElement('div');
        dimensionsLabel.style.position = 'absolute';
        dimensionsLabel.style.top = '0';
        dimensionsLabel.style.right = '0';
        dimensionsLabel.style.background = 'rgba(0,0,0,0.7)';
        dimensionsLabel.style.color = 'white';
        dimensionsLabel.style.padding = '2px 5px';
        dimensionsLabel.style.fontSize = '12px';
        dimensionsLabel.style.borderRadius = '0 0 0 5px';
        container.appendChild(dimensionsLabel);
        
        // Update dimensions label
        const updateDimensions = () => {
            dimensionsLabel.textContent = `${container.clientWidth}×${container.clientHeight}`;
        };
        
        // Initial dimensions
        updateDimensions();
        
        // Listen for resize events
        const resizeObserver = new ResizeObserver(() => {
            updateDimensions();
            // This will trigger recalculation of visible items
            container.dispatchEvent(new Event('scroll'));
        });
        
        resizeObserver.observe(container);
        
        console.log("Container is now resizable");
    }

    // disable
    enabled = true;

    array = toTracked(Array.from({ length: 500 }, (_, i) => {
        // Create items with varying content to produce different heights
        const type = i % 5; // Create 5 different types of items
        
        switch(type) {
            case 0:
                // Short item
                return { 
                    text: `Item ${i}`
                };
            case 1: 
                // Medium item with longer text
                return { 
                    text: `Item ${i} with some additional text that will make this item taller`
                };
            case 2:
                // Large item with much longer text
                return { 
                    text: `Item ${i} with a lot of content. This is a much longer description that will wrap to multiple lines and create a significantly taller item. We're adding even more text to ensure this item takes up more vertical space when rendered.`
                };
            case 3:
                // Item with image placeholder (will be taller)
                return { 
                    text: `Item ${i} with image`,
                };
            case 4:
                // Extra large item with very long content
                return { 
                    text: `Item ${i} with extremely long content. This item will have multiple paragraphs of text to make it very tall.\n\nThis is a second paragraph for this item. We're adding a lot of text to ensure this item is much taller than the others.\n\nAnd here's even a third paragraph with more content to make this item take up significant vertical space when rendered.`
                };
            default:
                // Add default case to ensure all paths return a value
                return { 
                    text: `Item ${i}`
                };
        }
    }));

    _selectedArrayIndex: number | undefined = 0;
 
    get selectedArrayIndex() {
        return this._selectedArrayIndex;
    }

    set selectedArrayIndex(val: number | undefined) {
        this._selectedArrayIndex = val;
    }
}

const textModel = toTracked(new TextModel());

const modelControl = document.getElementById('model') as HtmlControl
modelControl.model = textModel;

textModel.setupResizableContainer();

await sleepAsync(2000);
textModel.array.splice(3, 1); // Remove the item at index 3
console.log("Removed item at position 3");
await sleepAsync(1000);
textModel.array[1] = { 
    text: "Item 1 (modified)",
};

await sleepAsync(2000);
textModel.selectedArrayIndex = 7;

await sleepAsync(1000);
textModel.array.splice(2, 0, 
  { text: "New Item 1" },
  { text: "New Item 2" },
  { text: "New Item 3" }
);

await sleepAsync(1000);
textModel.array.splice(5, 1);
textModel.array.push({ text: "New Item End" });

await sleepAsync(1000);
textModel.array[4] = {
  text: "Item test",
};
console.log("Modified size of element at index 4");

