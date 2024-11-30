/* eslint-disable @typescript-eslint/no-unused-vars */
/// <reference types="@figma/plugin-typings" />

// State for resize functionality
let isResizing = false;
let _startWidth: number;
let startX: number;
let windowWidth: number;
let isLeftResize = false;
// Show the UI with initial size
figma.showUI(__html__, { 
  width: 320,  // Slightly wider to fit content
  height: 480, // Taller to show more variables
  themeColors: true,
  title: "Variables Manager"
});

// Define interface for our mapped variable structure
interface MappedVariable {
  name: string;
  collection: string;
  type: string;
  value: string | number | boolean | object | null;
  referenceName?: string | null;
  isReference?: boolean;
}

// Enhanced message handler to handle both existing and resize messages
figma.ui.onmessage = msg => {
  if (msg.type === 'resize') {
    figma.ui.resize(msg.width, msg.height);
  } else if (msg.type === 'resize-start') {
    isResizing = true;
    _startWidth = figma.viewport.bounds.width;
    startX = msg.mouseX;
    windowWidth = msg.windowWidth;
    isLeftResize = msg.isLeft;
  } else if (msg.type === 'resize-move' && isResizing) {
    const deltaX = msg.mouseX - startX;
    let newWidth = isLeftResize ? 
      windowWidth - deltaX : 
      windowWidth + deltaX;
    
    // Enforce minimum width
    newWidth = Math.max(240, newWidth);
    
    // Resize the plugin window
    figma.ui.resize(newWidth, 480); // Keep height constant at 480
  } else if (msg.type === 'resize-end') {
    isResizing = false;
  }
};

// Get all variables in the file
async function getVariables() {
  try {
    const collections = await figma.variables.getLocalVariableCollectionsAsync();
    console.log('Found collections:', collections.length);
    
    const allVariables: MappedVariable[] = [];
    const collectionNames: string[] = [];
    const variables = await figma.variables.getLocalVariablesAsync();
    
    // First pass: Create a map of all primitive variables
    const primitiveVarMap = new Map();
    variables.forEach(variable => {
      const collection = collections.find(c => c.id === variable.variableCollectionId);
      const modeId = collection?.modes[0].modeId;
      const value = modeId ? variable.valuesByMode[modeId] : null;
      
      // If it's a primitive (not a reference), store it in our map
      if (!(value && typeof value === 'object' && 'type' in value && value.type === 'VARIABLE_ALIAS')) {
        primitiveVarMap.set(variable.name, value);
      }
    });
    
    // Second pass: Process all variables
    for (const collection of collections) {
      const collectionVariables = variables.filter(v => v.variableCollectionId === collection.id);
      
      for (const variable of collectionVariables) {
        const collection = collections.find(c => c.id === variable.variableCollectionId);
        const modeId = collection?.modes[0]?.modeId;
        let value = modeId !== undefined ? variable.valuesByMode[modeId] : null;
        let referenceName = null;
        
        // Handle reference variables
        if (value && typeof value === 'object' && 'type' in value && value.type === 'VARIABLE_ALIAS') {
          // Get the referenced variable name
          const referencedVar = await figma.variables.getVariableByIdAsync(value.id);
          if (referencedVar) {
            referenceName = referencedVar.name;
            // Get the value directly from our primitive map
            value = primitiveVarMap.get(referenceName) || (modeId !== undefined ? referencedVar.valuesByMode[modeId] : null);
          }
        }

        allVariables.push({
          name: variable.name,
          collection: collection ? collection.name : 'Unknown Collection',
          type: variable.resolvedType,
          value: value,
          referenceName: referenceName,
          isReference: Boolean(referenceName)
        });
      }
      
      collectionNames.push(collection.name);
    }

    console.log('Sending variables to UI:', allVariables);

    figma.ui.postMessage({ 
      type: 'variables',
      variables: allVariables,
      collections: collectionNames
    });

  } catch (error) {
    console.error('Error:', error);
    figma.ui.postMessage({ 
      type: 'error', 
      message: 'Error loading variables' 
    });
  }
}

// Inject the UI resize handling script
const uiScript = `
  let isResizing = false;
  let currentHandle = null;

  // Get resize handles
  const leftHandle = document.getElementById('resizeHandleLeft');
  const rightHandle = document.getElementById('resizeHandleRight');

  // Add mouse down listeners to handles
  [leftHandle, rightHandle].forEach(handle => {
    handle.addEventListener('mousedown', (e) => {
      isResizing = true;
      currentHandle = handle;
      
      parent.postMessage({
        pluginMessage: {
          type: 'resize-start',
          mouseX: e.clientX,
          windowWidth: window.innerWidth,
          isLeft: handle.id === 'resizeHandleLeft'
        }
      }, '*');
    });
  });

  // Add mouse move and mouse up listeners to window
  window.addEventListener('mousemove', (e) => {
    if (isResizing) {
      parent.postMessage({
        pluginMessage: {
          type: 'resize-move',
          mouseX: e.clientX
        }
      }, '*');
    }
  });

  window.addEventListener('mouseup', () => {
    if (isResizing) {
      isResizing = false;
      currentHandle = null;
      
      parent.postMessage({
        pluginMessage: {
          type: 'resize-end'
        }
      }, '*');
    }
  });
`;

// Instead of using eval, inject the script via postMessage
figma.ui.postMessage({ 
  type: 'init-resize',
  script: uiScript 
});

// Start loading variables
getVariables();


function displayVariables(variables: MappedVariable[]) {
  const variableList = document.getElementById('variableList');
  const variableCount = document.getElementById('variableCount');

  function showNotification(message: string) {
  const notification = document.createElement('div');
  notification.className = 'notification';
  notification.textContent = message;
  document.body.appendChild(notification);

  // Remove notification after animation
  setTimeout(() => {
    notification.classList.add('fade-out');
    setTimeout(() => {
      document.body.removeChild(notification);
    }, 300);
  }, 2000);
}

  // Fallback clipboard copy function
  function fallbackCopyTextToClipboard(text: string) {
    const textArea = document.createElement('textarea');
    textArea.value = text;
    
    // Make the textarea out of viewport
    textArea.style.position = 'fixed';
    textArea.style.top = '0';
    textArea.style.left = '0';
    textArea.style.width = '2em';
    textArea.style.height = '2em';
    textArea.style.padding = '0';
    textArea.style.border = 'none';
    textArea.style.outline = 'none';
    textArea.style.boxShadow = 'none';
    textArea.style.background = 'transparent';

    document.body.appendChild(textArea);
    textArea.focus();
    textArea.select();

    try {
      const successful = document.execCommand('copy');
      const msg = successful ? 'successful' : 'unsuccessful';
      console.log(`Fallback: Copying text was ${msg}`);
    } catch (err) {
      console.error('Fallback copy failed', err);
    }

    document.body.removeChild(textArea);
  }

  // Check if variableList is not null before proceeding
  if (variableList) {
    variableList.innerHTML = '';

    // Update the variable count display
    if (variableCount) {
      variableCount.textContent = variables.length.toString();
    }
    
    if (variables.length === 0) {
      variableList.innerHTML = '<div class="empty-message">No variables found</div>';
      if (variableCount) {
        variableCount.textContent = '0';
      }
      return;
    }

    variables.forEach((variable: MappedVariable) => {
      const variableDiv = document.createElement('div');
      variableDiv.textContent = variable.name;
      variableDiv.style.cursor = 'pointer';
      variableDiv.className = 'variable-item';
      
      // Add click event listener with clipboard functionality
      variableDiv.addEventListener('click', () => {
        if (navigator.clipboard && navigator.clipboard.writeText) {
          navigator.clipboard.writeText(variable.name)
            .then(() => {
              showNotification(`Copied "${variable.name}" to clipboard!`);
            })
            .catch(err => {
              console.error('Failed to copy: ', err);
              fallbackCopyTextToClipboard(variable.name);
            });
        } else {
          fallbackCopyTextToClipboard(variable.name);
        }
      });

      variableList.appendChild(variableDiv);
    });

  } else {
    console.error('variableList element not found');
  }
}