import { GUI } from 'lil-gui';

// HTMLからcanvas要素を取得
const canvas = document.getElementById('sand-canvas');
const ctx = canvas.getContext('2d');
const uiCanvas = document.getElementById('ui-canvas');
const uiCtx = uiCanvas.getContext('2d');
const canvasContainer = document.getElementById('canvas-container');

const CANVAS_WIDTH = 720;
const CANVAS_HEIGHT = 720;

const params = {
    // GUIでズーム率を操作するためのパラメータ
    zoom: 1,
    grainSize: 3,
    digBrushRadius: 10,
    resetBrushRadius: 20,
    brushWobble: 3,
    digDepth: 100,
    shadowIntensity: 0.8,
    highlightIntensity: 0.4,
    // ★★★ 変更: 光の方向のデフォルト値を変更 ★★★
    lightDirection: 'Left',
    topColor: '#FFFFFF',
    bottomColor: '#000000',
    tineCount: 15,
    pivotTineCount: 5,
    reset: () => {
        initGrid();
        drawGravel(null);
        ctx.putImageData(imageData, 0, 0);
    },
    save: saveCanvasAsPNG,
    rakeHorizontal: () => { rake.angle = 0; },
    rakeVertical: () => { rake.angle = Math.PI / 2; }
};

const INITIAL_HEIGHT_PALETTE = [80, 100, 120, 140, 160, 180, 200];
const BRUSH_WOBBLE_VERTICES = 12;

let gridWidth, gridHeight, heightMap, isDrawing = false,
    currentTool = 'dig',
    dirtyRect = null,
    lastGridX = 0,
    lastGridY = 0;
let colorPalette = [];
let mouseX = 0,
    mouseY = 0;
let imageData = null;

let rake = {
    center: { x: 0, y: 0 },
    angle: 0,
    grabbedTineIndex: -99,
    initialDragState: null,
    lastTinePositions: [],
};
let isRakeMode = false;
let isAutoRotating = false;
let lastTimestamp = 0;

let lastScale = 1;
// GUIコントローラーを格納する変数
let zoomController;

function isPivotTine(index, totalTines, pivotsPerSide) {
    if (index === Math.floor(totalTines / 2)) return false;
    return index < pivotsPerSide || index >= totalTines - pivotsPerSide;
}

function getTinePositions() {
    const positions = [];
    const spacing = params.digBrushRadius * 1.5;
    const cosA = Math.cos(rake.angle);
    const sinA = Math.sin(rake.angle);
    const halfCount = Math.floor(params.tineCount / 2);

    for (let i = -halfCount; i <= halfCount; i++) {
        const localX = i * spacing;
        const rotatedX = localX * cosA;
        const rotatedY = localX * sinA;
        positions.push({
            x: rake.center.x + rotatedX,
            y: rake.center.y + rotatedY
        });
    }
    return positions;
}

// ★★★ 変更: 仮想ピクセル(パディング)を含むグリッドを初期化 ★★★
function initGrid() {
    // 表示されるグリッドのサイズ
    const visibleGridWidth = Math.ceil(canvas.width / params.grainSize);
    const visibleGridHeight = Math.ceil(canvas.height / params.grainSize);

    // 上下左右に1ピクセルずつパディングを追加した、実際のデータ上のグリッドサイズ
    gridWidth = visibleGridWidth + 2;
    gridHeight = visibleGridHeight + 2;
    
    imageData = ctx.createImageData(canvas.width, canvas.height);
    
    // パディングを含んだサイズのheightMapを生成
    heightMap = Array(gridHeight).fill(0).map(() => Array(gridWidth).fill(0).map(() => {
        const randomIndex = getRandomNormalIndex(INITIAL_HEIGHT_PALETTE.length);
        return INITIAL_HEIGHT_PALETTE[randomIndex];
    }));
    
    // Rakeの中心は表示領域の中心に設定
    rake.center = { x: visibleGridWidth / 2, y: visibleGridHeight / 2 };
}

// ★★★ 変更: 仮想ピクセルを考慮した描画と、新しい光の計算ロジック ★★★
function drawGravel(rect = null) {
    // rectが指定されている場合は、パディング分座標をずらす
    const startX = rect ? rect.x + 1 : 1;
    const startY = rect ? rect.y + 1 : 1;
    const endX = rect ? rect.x + rect.width + 1 : gridWidth - 1;
    const endY = rect ? rect.y + rect.height + 1 : gridHeight - 1;

    const clampedStartX = Math.max(1, startX);
    const clampedStartY = Math.max(1, startY);
    const clampedEndX = Math.min(gridWidth - 1, endX);
    const clampedEndY = Math.min(gridHeight - 1, endY);

    const grainSize = params.grainSize;
    const canvasWidth = canvas.width;

    // 表示領域のみをループ (パディングの1px分は除く)
    for (let y = clampedStartY; y < clampedEndY; y++) {
        for (let x = clampedStartX; x < clampedEndX; x++) {
            const baseHeight = heightMap[y][x];
            let lightAmount = 0;

            // ★★★ 変更: 計算ロジックを以前のバージョンに戻し、光の方向に対応 ★★★
            switch (params.lightDirection) {
                case 'Left':
                    if (heightMap[y][x] > heightMap[y][x - 1]) lightAmount += baseHeight * params.highlightIntensity;
                    if (heightMap[y][x] > heightMap[y][x + 1]) lightAmount -= baseHeight * params.shadowIntensity;
                    break;
                case 'Right':
                    if (heightMap[y][x] > heightMap[y][x + 1]) lightAmount += baseHeight * params.highlightIntensity;
                    if (heightMap[y][x] > heightMap[y][x - 1]) lightAmount -= baseHeight * params.shadowIntensity;
                    break;
                case 'Up':
                    if (heightMap[y][x] > heightMap[y - 1][x]) lightAmount += baseHeight * params.highlightIntensity;
                    if (heightMap[y][x] > heightMap[y + 1][x]) lightAmount -= baseHeight * params.shadowIntensity;
                    break;
                case 'Down':
                    if (heightMap[y][x] > heightMap[y + 1][x]) lightAmount += baseHeight * params.highlightIntensity;
                    if (heightMap[y][x] > heightMap[y - 1][x]) lightAmount -= baseHeight * params.shadowIntensity;
                    break;
            }

            const paletteSteps = 256;
            const paletteIndex = Math.min(paletteSteps - 1, Math.floor((baseHeight / 255) * paletteSteps));
            const baseColor = colorPalette[paletteIndex];
            if (baseColor) {
                const finalR = Math.max(0, Math.min(255, baseColor.r + lightAmount));
                const finalG = Math.max(0, Math.min(255, baseColor.g + lightAmount));
                const finalB = Math.max(0, Math.min(255, baseColor.b + lightAmount));

                for (let py = 0; py < grainSize; py++) {
                    for (let px = 0; px < grainSize; px++) {
                        // imageDataに書き込む際は、パディング分(x-1, y-1)を引いて座標を合わせる
                        const canvasX = (x - 1) * grainSize + px;
                        const canvasY = (y - 1) * grainSize + py;
                        const index = (canvasY * canvasWidth + canvasX) * 4;
                        imageData.data[index] = finalR;
                        imageData.data[index + 1] = finalG;
                        imageData.data[index + 2] = finalB;
                        imageData.data[index + 3] = 255;
                    }
                }
            }
        }
    }
}

// ★★★ 変更: 仮想ピクセルを考慮したブラシ処理 ★★★
function applyBrush(mouseGridX, mouseGridY) {
    const currentBrushRadius = (currentTool === 'dig') ? params.digBrushRadius : params.resetBrushRadius;
    const baseOuterRadius = currentBrushRadius;
    const baseInnerRadius = baseOuterRadius / 2;
    const wobblyShapeRadii = generateWobblyShape(baseOuterRadius, params.brushWobble, BRUSH_WOBBLE_VERTICES);
    const maxPossibleRadius = Math.ceil(baseOuterRadius + params.brushWobble);
    const innerRadiusSq = baseInnerRadius * baseInnerRadius;
    let totalVolumeChange = 0;
    const changes = [];
    const distributionCells = [];
    let totalDistributionWeight = 0;

    for (let y = -maxPossibleRadius; y <= maxPossibleRadius; y++) {
        for (let x = -maxPossibleRadius; x <= maxPossibleRadius; x++) {
            const interpolatedOuterRadius = getInterpolatedRadius(x, y, wobblyShapeRadii);
            const distanceSq = x * x + y * y;
            if (distanceSq > interpolatedOuterRadius * interpolatedOuterRadius) continue;

            // heightMap上の座標(パディング分+1)
            const targetX = mouseGridX + x + 1;
            const targetY = mouseGridY + y + 1;

            // 境界チェックはパディングを含むgridWidth/gridHeightで行う
            if (targetX >= 0 && targetX < gridWidth && targetY >= 0 && targetY < gridHeight) {
                const distance = Math.sqrt(distanceSq);
                if (distanceSq <= innerRadiusSq) {
                    const oldHeight = heightMap[targetY][targetX];
                    let actualNewHeight = oldHeight;
                    let actualVolumeChange = 0;
                    if (currentTool === 'dig') {
                        const minDigHeight = params.digDepth - 20;
                        if (oldHeight >= minDigHeight) {
                            const falloff = 1 - (distance / baseInnerRadius);
                            const targetHeight = minDigHeight + Math.random() * 40;
                            actualNewHeight = oldHeight * (1 - falloff) + targetHeight * falloff;
                        }
                    } else {
                        const randomIndex = getRandomNormalIndex(INITIAL_HEIGHT_PALETTE.length);
                        actualNewHeight = INITIAL_HEIGHT_PALETTE[randomIndex];
                    }
                    actualNewHeight = Math.max(0, Math.min(255, actualNewHeight));
                    if (currentTool === 'dig') {
                        actualVolumeChange = oldHeight - actualNewHeight;
                    }
                    changes.push({ x: targetX, y: targetY, newHeight: actualNewHeight });
                    totalVolumeChange += actualVolumeChange;
                } else {
                    const ringWidth = interpolatedOuterRadius - baseInnerRadius;
                    if (ringWidth > 0) {
                        const weight = 1 - ((distance - baseInnerRadius) / ringWidth);
                        distributionCells.push({ x: targetX, y: targetY, weight: weight });
                        totalDistributionWeight += weight;
                    }
                }
            }
        }
    }

    changes.forEach(change => {
        heightMap[change.y][change.x] = change.newHeight;
    });

    if (distributionCells.length > 0 && totalDistributionWeight > 0) {
        distributionCells.forEach(cell => {
            const proportion = cell.weight / totalDistributionWeight;
            const heightToAdd = totalVolumeChange * proportion;
            heightMap[cell.y][cell.x] += heightToAdd;
        });
    }

    // dirtyRectは表示領域の座標で管理
    const updateRect = {
        x: mouseGridX - maxPossibleRadius - 1,
        y: mouseGridY - maxPossibleRadius - 1,
        width: maxPossibleRadius * 2 + 2,
        height: maxPossibleRadius * 2 + 2
    };

    // heightMapへの書き込みはパディングを考慮
    for (let y = Math.floor(updateRect.y); y < updateRect.y + updateRect.height; y++) {
        for (let x = Math.floor(updateRect.x); x < updateRect.x + updateRect.width; x++) {
            const mapX = x + 1;
            const mapY = y + 1;
            if (mapX >= 0 && mapX < gridWidth && mapY >= 0 && mapY < gridHeight) {
                heightMap[mapY][mapX] = Math.max(0, Math.min(255, heightMap[mapY][mapX]));
            }
        }
    }

    if (!dirtyRect) {
        dirtyRect = updateRect;
    } else {
        const newX = Math.min(dirtyRect.x, updateRect.x);
        const newY = Math.min(dirtyRect.y, updateRect.y);
        dirtyRect.width = Math.max(dirtyRect.x + dirtyRect.width, updateRect.x + updateRect.width) - newX;
        dirtyRect.height = Math.max(dirtyRect.y + dirtyRect.height, updateRect.y + updateRect.height) - newY;
        dirtyRect.x = newX;
        dirtyRect.y = newY;
    }
}

function drawLineOnGrid(x0, y0, x1, y1, onPixel) {
    const dx = Math.abs(x1 - x0);
    const dy = -Math.abs(y1 - y0);
    const sx = x0 < x1 ? 1 : -1;
    const sy = y0 < y1 ? 1 : -1;
    let err = dx + dy;
    while (true) {
        onPixel(x0, y0);
        if (x0 === x1 && y0 === y1) break;
        const e2 = 2 * err;
        if (e2 >= dy) {
            err += dy;
            x0 += sx;
        }
        if (e2 <= dx) {
            err += dx;
            y0 += sy;
        }
    }
}

function saveCanvasAsPNG() {
    const tempCanvas = document.createElement('canvas');
    const tempCtx = tempCanvas.getContext('2d');
    const outputSize = 720 / params.grainSize;
    tempCanvas.width = outputSize;
    tempCanvas.height = outputSize;
    tempCtx.drawImage(canvas, 0, 0, outputSize, outputSize);
    const date = new Date();
    const timestamp = date.getFullYear() +
        ('0' + (date.getMonth() + 1)).slice(-2) +
        ('0' + date.getDate()).slice(-2) + '_' +
        ('0' + date.getHours()).slice(-2) +
        ('0' + date.getMinutes()).slice(-2) +
        ('0' + date.getSeconds()).slice(-2);
    const filename = `karesansui_${timestamp}.png`;
    const link = document.createElement('a');
    link.download = filename;
    link.href = tempCanvas.toDataURL('image/png');
    link.click();
}

function generateColorPalette(topColorHex, bottomColorHex, steps) {
    const parseColor = (hex) => {
        const r = parseInt(hex.slice(1, 3), 16);
        const g = parseInt(hex.slice(3, 5), 16);
        const b = parseInt(hex.slice(5, 7), 16);
        return { r, g, b };
    };
    const top = parseColor(topColorHex);
    const bottom = parseColor(bottomColorHex);
    const palette = [];
    for (let i = 0; i < steps; i++) {
        const t = i / (steps - 1);
        const r = Math.round(bottom.r * (1 - t) + top.r * t);
        const g = Math.round(bottom.g * (1 - t) + top.g * t);
        const b = Math.round(bottom.b * (1 - t) + top.b * t);
        palette.push({ r, g, b });
    }
    return palette;
}

function getRandomNormalIndex(arrayLength) {
    const iterations = 3;
    let sum = 0;
    for (let i = 0; i < iterations; i++) {
        sum += Math.random();
    }
    const normalized = sum / iterations;
    const index = Math.floor(normalized * arrayLength);
    return Math.min(index, arrayLength - 1);
}

function generateWobblyShape(baseRadius, fluctuation, numVertices) {
    const shape = [];
    for (let i = 0; i < numVertices; i++) {
        const randomFluctuation = (Math.random() - 0.5) * 2 * fluctuation;
        shape.push(baseRadius + randomFluctuation);
    }
    return shape;
}

function getInterpolatedRadius(x, y, shape) {
    const numVertices = shape.length;
    let angle = Math.atan2(y, x) + Math.PI;
    const angleRatio = angle / (2 * Math.PI);
    const floatIndex = angleRatio * numVertices;
    const index1 = Math.floor(floatIndex) % numVertices;
    const index2 = (index1 + 1) % numVertices;
    const radius1 = shape[index1];
    const radius2 = shape[index2];
    const blend = floatIndex - Math.floor(floatIndex);
    return radius1 * (1 - blend) + radius2 * blend;
}

function drawRakeCursor() {
    if (!isRakeMode) return;
    const tinePositions = getTinePositions();
    const cursorRadius = params.grainSize * 2.5 * lastScale;
    const sandRect = canvas.getBoundingClientRect();

    uiCtx.strokeStyle = 'rgba(255, 255, 255, 0.9)';
    uiCtx.lineWidth = 2 * lastScale;

    const halfCount = Math.floor(params.tineCount / 2);

    tinePositions.forEach((pos, index) => {
        if (index === halfCount) {
            uiCtx.fillStyle = 'rgba(200, 0, 0, 0.8)';
        } else if (isPivotTine(index, params.tineCount, params.pivotTineCount)) {
            uiCtx.fillStyle = 'rgba(0, 180, 0, 0.8)';
        } else {
            uiCtx.fillStyle = 'rgba(0, 0, 0, 0.8)';
        }

        const px = (pos.x * params.grainSize * lastScale) + sandRect.left;
        const py = (pos.y * params.grainSize * lastScale) + sandRect.top;
        uiCtx.beginPath();
        uiCtx.arc(px, py, cursorRadius, 0, Math.PI * 2);
        uiCtx.fill();
        uiCtx.stroke();
    });
}


function animationLoop(currentTimestamp) {
    const deltaTime = (currentTimestamp - lastTimestamp) / 1000;
    lastTimestamp = currentTimestamp;

    if (isAutoRotating) {
        const rotationSpeed = Math.PI;
        const lastPositions = getTinePositions();
        rake.angle += rotationSpeed * deltaTime;
        const newPositions = getTinePositions();
        currentTool = 'dig';
        newPositions.forEach((newPos, i) => {
            if (!isPivotTine(i, newPositions.length, params.pivotTineCount)) {
                const lastPos = lastPositions[i];
                drawLineOnGrid(Math.round(lastPos.x), Math.round(lastPos.y), Math.round(newPos.x), Math.round(newPos.y), (x, y) => {
                    applyBrush(x, y);
                });
            }
        });
    }

    if (dirtyRect) {
        drawGravel(dirtyRect);
        ctx.putImageData(imageData, 0, 0);
        dirtyRect = null;
    }

    uiCtx.clearRect(0, 0, uiCanvas.width, uiCanvas.height);
    if (isRakeMode) {
        drawRakeCursor();
    }
    requestAnimationFrame(animationLoop);
}

window.addEventListener('load', () => {
    const gui = new GUI();
    
    zoomController = gui.add(params, 'zoom', 0.5, 1.0, 0.01).name('Zoom');
    zoomController.onChange((value) => {
        lastScale = value;
        canvasContainer.style.transform = `scale(${value})`;
    });

    gui.add(params, 'grainSize', 1, 6, 1).name('Grain Size').onFinishChange(() => {
        initGrid();
        drawGravel(null);
        ctx.putImageData(imageData, 0, 0);
    });

    const brushFolder = gui.addFolder('Brush Settings');
    brushFolder.add(params, 'digDepth', 20, 160, 1).name('Dig Depth');
    brushFolder.add(params, 'digBrushRadius', 5, 60, 1).name('Dig Radius (Left)');
    brushFolder.add(params, 'resetBrushRadius', 5, 60, 1).name('Reset Radius (Right)');
    brushFolder.add(params, 'brushWobble', 0, 10, 1).name('Shape Wobble');

    const appearanceFolder = gui.addFolder('Appearance');
    const updateColorsAndRedraw = () => {
        colorPalette = generateColorPalette(params.topColor, params.bottomColor, 256);
        drawGravel(null);
        ctx.putImageData(imageData, 0, 0);
    };
    appearanceFolder.addColor(params, 'topColor').name('Top Color').onFinishChange(updateColorsAndRedraw);
    appearanceFolder.addColor(params, 'bottomColor').name('Bottom Color').onFinishChange(updateColorsAndRedraw);
    appearanceFolder.add(params, 'shadowIntensity', 0, 1.5, 0.01).name('Shadow Intensity').onFinishChange(() => {
        drawGravel(null);
        ctx.putImageData(imageData, 0, 0);
    });
    appearanceFolder.add(params, 'highlightIntensity', 0, 1.5, 0.01).name('Highlight Intensity').onFinishChange(() => {
        drawGravel(null);
        ctx.putImageData(imageData, 0, 0);
    });
    // ★★★ 変更: 光の方向の選択肢をGUIに設定 ★★★
    appearanceFolder.add(params, 'lightDirection', ['Left', 'Right', 'Up', 'Down']).name('Light Direction').onFinishChange(() => {
        drawGravel(null);
        ctx.putImageData(imageData, 0, 0);
    });

    const rakeFolder = gui.addFolder('Rake Settings');
    const validateRakeParams = () => {
        const maxPivots = Math.floor((params.tineCount - 1) / 2);
        if (params.pivotTineCount > maxPivots) {
            params.pivotTineCount = maxPivots;
        }
    };
    rakeFolder.add(params, 'pivotTineCount', 0, 7, 1).name('Pivot Tines (each side)').onChange(validateRakeParams);

    const actionsFolder = gui.addFolder('Actions');
    actionsFolder.add(params, 'rakeHorizontal').name('Rake Horizontal (H)');
    actionsFolder.add(params, 'rakeVertical').name('Rake Vertical (V)');
    actionsFolder.add(params, 'save').name('Save as PNG (S)');
    actionsFolder.add(params, 'reset').name('Reset (R)');

    const shortcutsFolder = gui.addFolder('Shortcuts');
    shortcutsFolder.add({ info: "Toggle with 'K' key" }, 'info').name('Rake Mode').disable();
    shortcutsFolder.close();

    canvas.width = CANVAS_WIDTH;
    canvas.height = CANVAS_HEIGHT;
    uiCanvas.width = window.innerWidth;
    uiCanvas.height = window.innerHeight;

    initGrid();
    updateColorsAndRedraw();
    requestAnimationFrame(animationLoop);
});

window.addEventListener('resize', () => {
    uiCanvas.width = window.innerWidth;
    uiCanvas.height = window.innerHeight;
});

window.addEventListener('keydown', (e) => {
    if (e.target.closest('.lil-gui')) return;
    if (e.key === 'r' || e.key === 'R') {
        params.reset();
    } else if (e.key === 's' || e.key === 'S') {
        e.preventDefault();
        saveCanvasAsPNG();
    } else if (e.key === 'k' || e.key === 'K') {
        isRakeMode = !isRakeMode;
        if (isRakeMode) {
            const rect = canvas.getBoundingClientRect();
            const mouseXOnCanvas = (mouseX - rect.left) / lastScale;
            const mouseYOnCanvas = (mouseY - rect.top) / lastScale;
            rake.center.x = Math.floor(mouseXOnCanvas / params.grainSize);
            rake.center.y = Math.floor(mouseYOnCanvas / params.grainSize);
        }
    } else if (e.key === 'h' || e.key === 'H') {
        rake.angle = 0;
    } else if (e.key === 'v' || e.key === 'V') {
        rake.angle = Math.PI / 2;
    }
});

window.addEventListener('mousedown', (e) => {
    if (e.target.closest('.lil-gui')) return;

    isDrawing = true;
    currentTool = (e.button === 0) ? 'dig' : 'reset';
    const rect = canvas.getBoundingClientRect();
    const mouseXOnCanvas = (e.clientX - rect.left) / lastScale;
    const mouseYOnCanvas = (e.clientY - rect.top) / lastScale;
    const currentGridX = Math.floor(mouseXOnCanvas / params.grainSize);
    const currentGridY = Math.floor(mouseYOnCanvas / params.grainSize);

    lastGridX = currentGridX;
    lastGridY = currentGridY;

    if (isRakeMode) {
        const tinePositions = getTinePositions();
        let tineFound = -99;
        const grabRadius = params.digBrushRadius;
        const halfCount = Math.floor(params.tineCount / 2);

        tinePositions.forEach((pos, index) => {
            const dx = pos.x - currentGridX;
            const dy = pos.y - currentGridY;
            if (dx * dx + dy * dy < grabRadius * grabRadius) {
                tineFound = index - halfCount;
            }
        });

        if (tineFound !== -99) {
            if (tineFound === 0 && e.button === 2) {
                isAutoRotating = true;
                e.preventDefault();
            } else if (e.button === 0) {
                rake.grabbedTineIndex = tineFound;
                rake.initialDragState = {
                    rakeCenter: { ...rake.center },
                    rakeAngle: rake.angle,
                    mousePos: { x: currentGridX, y: currentGridY },
                    tinePositions: tinePositions
                };
                rake.lastTinePositions = tinePositions;
            } else {
                isDrawing = false;
            }
        } else {
            isDrawing = false;
        }
    } else {
        if (mouseXOnCanvas < 0 || mouseXOnCanvas > CANVAS_WIDTH || mouseYOnCanvas < 0 || mouseYOnCanvas > CANVAS_HEIGHT) {
            isDrawing = false;
            return;
        }
        applyBrush(currentGridX, currentGridY);
    }
});

window.addEventListener('mousemove', (e) => {
    mouseX = e.clientX;
    mouseY = e.clientY;
    if (!isDrawing || isAutoRotating) return;

    const rect = canvas.getBoundingClientRect();
    const mouseXOnCanvas = (e.clientX - rect.left) / lastScale;
    const mouseYOnCanvas = (e.clientY - rect.top) / lastScale;
    const currentGridX = Math.floor(mouseXOnCanvas / params.grainSize);
    const currentGridY = Math.floor(mouseYOnCanvas / params.grainSize);

    if (currentGridX === lastGridX && currentGridY === lastGridY) return;

    if (isRakeMode) {
        if (rake.grabbedTineIndex > -99) {
            const initialState = rake.initialDragState;
            const mouseDelta = { x: currentGridX - initialState.mousePos.x, y: currentGridY - initialState.mousePos.y };
            const halfCount = Math.floor(params.tineCount / 2);

            if (rake.grabbedTineIndex === 0) {
                const perpVec = { x: -Math.sin(initialState.rakeAngle), y: Math.cos(initialState.rakeAngle) };
                const dot = mouseDelta.x * perpVec.x + mouseDelta.y * perpVec.y;
                rake.center.x = initialState.rakeCenter.x + perpVec.x * dot;
                rake.center.y = initialState.rakeCenter.y + perpVec.y * dot;
            } else {
                const pivotIndex = (params.tineCount - 1) - (rake.grabbedTineIndex + halfCount);
                const pivot = initialState.tinePositions[pivotIndex];
                const initialGrabbedPos = initialState.tinePositions[rake.grabbedTineIndex + halfCount];
                const initialVec = { x: initialGrabbedPos.x - pivot.x, y: initialGrabbedPos.y - pivot.y };
                const currentVec = { x: currentGridX - pivot.x, y: currentGridY - pivot.y };
                const angleInitial = Math.atan2(initialVec.y, initialVec.x);
                const angleCurrent = Math.atan2(currentVec.y, currentVec.x);
                const angleDelta = angleCurrent - angleInitial;
                rake.angle = initialState.rakeAngle + angleDelta;
                const initialCenterVec = { x: initialState.rakeCenter.x - pivot.x, y: initialState.rakeCenter.y - pivot.y };
                const cosA = Math.cos(angleDelta);
                const sinA = Math.sin(angleDelta);
                const rotatedCenterVecX = initialCenterVec.x * cosA - initialCenterVec.y * sinA;
                const rotatedCenterVecY = initialCenterVec.x * sinA + initialCenterVec.y * cosA;
                rake.center.x = pivot.x + rotatedCenterVecX;
                rake.center.y = pivot.y + rotatedCenterVecY;
            }
            const newTinePositions = getTinePositions();
            currentTool = 'dig';
            newTinePositions.forEach((newPos, i) => {
                if (!isPivotTine(i, newTinePositions.length, params.pivotTineCount)) {
                    const lastPos = rake.lastTinePositions[i];
                    drawLineOnGrid(Math.round(lastPos.x), Math.round(lastPos.y), Math.round(newPos.x), Math.round(newPos.y), (x, y) => {
                        applyBrush(x, y);
                    });
                }
            });
            rake.lastTinePositions = newTinePositions;
        }
    } else {
        if (e.buttons === 1) {
            currentTool = 'dig';
        } else if (e.buttons === 2) {
            currentTool = 'reset';
        } else {
            isDrawing = false;
            return;
        }

        drawLineOnGrid(lastGridX, lastGridY, currentGridX, currentGridY, (x, y) => {
            applyBrush(x, y);
        });
    }

    lastGridX = currentGridX;
    lastGridY = currentGridY;
});

window.addEventListener('mouseup', () => {
    isDrawing = false;
    isAutoRotating = false;
    rake.grabbedTineIndex = -99;
    rake.initialDragState = null;
});

canvas.addEventListener('contextmenu', (e) => e.preventDefault());

