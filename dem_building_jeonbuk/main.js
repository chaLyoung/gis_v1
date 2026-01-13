// ========================================
// 서버 주소 설정
// ========================================
const TILESERVER_BASE_URL = 'http://10.200.100.11:8080'; 
const GEOSERVER_BASE_URL = 'http://10.200.100.11:18080'; 
const GEOSERVER_WORKSPACE = 'aetem'; 
const TERRAIN_SERVER_URL = 'http://10.200.100.11:8091';
const GEOSERVER_WFS_URL = `${GEOSERVER_BASE_URL}/geoserver/${GEOSERVER_WORKSPACE}/ows`;
const BUILDING_LAYER_NAME = `${GEOSERVER_WORKSPACE}:testAetem`;

// ========================================
// 타일 기반 로딩 설정
// ========================================
const TILE_CONFIG = {
    minZoomHeight: 50000,      // 이 고도 이하에서만 건물 로드 (50km)
    maxZoomHeight: 100,        // 최소 고도 (100m)
    tileLoadRadius: 0.03,      // 타일 크기 (위경도 기준, 약 5km)
    maxConcurrentLoads: 2,     // 동시 로드 가능한 타일 수
    cacheSize: 50              // 캐시할 타일 수
};

// ========================================
// Cesium 뷰어 초기화
// ========================================
let viewer;

try {
    viewer = new Cesium.Viewer('cesiumContainer', {
        imageryProvider: false,
        terrainProvider: new Cesium.EllipsoidTerrainProvider({}),
        baseLayerPicker: false,
        geocoder: false,
        homeButton: false,
        sceneModePicker: false,
        navigationHelpButton: false,
        animation: false,
        timeline: false,
        fullscreenButton: true,
        vrButton: false,
        infoBox: false,
        selectionIndicator: false,
        scene3DOnly: true,
        requestRenderMode: true,
        maximumRenderTimeChange: Infinity
    });
    
    console.log("✅ Cesium 뷰어 초기화 성공");
    
} catch (error) {
    console.error("🚨 Cesium 초기화 실패:", error);
    alert("Cesium 초기화 실패!\n" + error.message);
    throw error;
}

// 성능 최적화
viewer.scene.fog.enabled = false;
viewer.scene.skyAtmosphere.show = false;
viewer.scene.globe.enableLighting = false;
viewer.scene.globe.depthTestAgainstTerrain = false;

// ========================================
// 커스텀 3D 지형 로딩
// ========================================
setTimeout(function() {
    Cesium.CesiumTerrainProvider.fromUrl(TERRAIN_SERVER_URL, {
        requestVertexNormals: false
    }).then(function(provider) {
        viewer.terrainProvider = provider;
        console.log("✅ 3D 지형 로딩 성공!");
    }).catch(function(error) {
        console.warn("⚠️  3D 지형 로딩 실패:", error.message);
    });
}, 2000);

// ========================================
// 마우스 컨트롤
// ========================================
const controller = viewer.scene.screenSpaceCameraController;
controller.enableRotate = true;
controller.enableTranslate = true;
controller.enableZoom = true;
controller.enableTilt = true;
controller.enableLook = false;

controller.translateEventTypes = Cesium.CameraEventType.LEFT_DRAG;
controller.rotateEventTypes = Cesium.CameraEventType.RIGHT_DRAG;
controller.zoomEventTypes = Cesium.CameraEventType.WHEEL;
controller.tiltEventTypes = [
    Cesium.CameraEventType.MIDDLE_DRAG,
    {
        eventType: Cesium.CameraEventType.LEFT_DRAG,
        modifier: Cesium.KeyboardEventModifier.SHIFT
    }
];

controller.minimumZoomDistance = 10;
controller.maximumZoomDistance = 20000000;

viewer.screenSpaceEventHandler.removeInputAction(
    Cesium.ScreenSpaceEventType.LEFT_DOUBLE_CLICK
);

viewer.imageryLayers.addImageryProvider(
    new Cesium.UrlTemplateImageryProvider({
        url: `${TILESERVER_BASE_URL}/styles/OSM%20OpenMapTiles/{z}/{x}/{y}.png`,
        credit: 'OpenStreetMap contributors',
        maximumLevel: 14,
        rectangle: Cesium.Rectangle.fromDegrees(124.5, 33.0, 132.0, 38.8) 
    }),
    0
);

// ========================================
// WFS 기반 건물 로딩 시스템 (대용량 처리용)
// ========================================
class BuildingTileManager {
    constructor() {
        this.loadedTiles = new Map();       // 로드된 타일 캐시
        this.visibleEntities = new Set();   // 현재 화면에 표시된 엔티티
        this.isEnabled = true;              
        this.dataSource = null;             
        this.currentLoads = 0;              
    }

    // 타일 ID 계산
    getTileId(lon, lat) {
        const tileSize = TILE_CONFIG.tileLoadRadius; // 약 0.05도 (5km)
        const tileX = Math.floor(lon / tileSize);
        const tileY = Math.floor(lat / tileSize);
        return `${tileX}_${tileY}`;
    }

    // 타일의 경계박스(BBOX) 계산
    getTileBounds(tileId) {
        const [tileX, tileY] = tileId.split('_').map(Number);
        const tileSize = TILE_CONFIG.tileLoadRadius;
        return {
            minLon: tileX * tileSize,
            minLat: tileY * tileSize,
            maxLon: (tileX + 1) * tileSize,
            maxLat: (tileY + 1) * tileSize
        };
    }

    // [핵심] GeoServer에 WFS 요청 보내기
    async loadTile(tileId) {
        // 1. 이미 로드한 타일이면 캐시 반환
        if (this.loadedTiles.has(tileId)) {
            return this.loadedTiles.get(tileId);
        }

        const bounds = this.getTileBounds(tileId);
        
        // 2. WFS 요청 URL 생성
        // BBOX=minLon,minLat,maxLon,maxLat 순서
        const params = new URLSearchParams({
            service: 'WFS',
            version: '2.0.0',
            request: 'GetFeature',
            typeNames: BUILDING_LAYER_NAME,
            srsName: 'EPSG:4326',   // ✅ 응답 좌표계 강제
            outputFormat: 'application/json',   // GeoJSON으로 받기
            count: '2000',
            bbox: `${bounds.minLon},${bounds.minLat},${bounds.maxLon},${bounds.maxLat},EPSG:4326`,
        });

        const url = `${GEOSERVER_WFS_URL}?${params.toString()}`;
        console.log(`🌐 WFS 요청: ${tileId} ${url}`);

        try {
            // 3. 데이터 Fetch
            const response = await fetch(url);
            console.log(`🌐 WFS 응답: ${response.status}`)
            if (!response.ok) throw new Error(`WFS Error: ${response.status}`);
            
            const geojson = await response.json();
            console.log(geojson)
            const features = geojson.features || [];
            
            const tileEntities = [];

            // 4. 엔티티 생성
            for (const feature of features) {
                const entity = this.createBuildingEntity(feature);
                if (entity) tileEntities.push(entity);
            }

            // 5. 캐시에 저장
            this.loadedTiles.set(tileId, tileEntities);
            
            if (tileEntities.length > 0) {
                console.log(`🏙️ 타일 ${tileId} 로드완료: 건물 ${tileEntities.length}개`);
            }
            
            return tileEntities;

        } catch (error) {
            console.warn(`⚠️ 타일 ${tileId} 로딩 실패:`, error);
            return []; // 실패 시 빈 배열 반환
        }
    }

    // 건물 엔티티 생성 (이전 로직과 동일)
    createBuildingEntity(feature) {
        try {
            if (!feature.geometry || !feature.geometry.coordinates) return null;

            const coords = feature.geometry.coordinates;
            let polygonCoords;

            if (feature.geometry.type === 'Polygon') polygonCoords = coords[0];
            else if (feature.geometry.type === 'MultiPolygon') polygonCoords = coords[0][0];
            else return null;

            const positions = polygonCoords.map(c => Cesium.Cartesian3.fromDegrees(c[0], c[1]));

            // 높이 정보 추출
            const props = feature.properties || {};
            
            // 1순위: A16 (높이)
            let height = parseFloat(props.A16 || props.a16 || 0);
            
            // 2순위: A26 (층수)
            if (height <= 0) {
                const floors = parseFloat(props.A26 || props.a26 || props.GRO_FLO_CO || 0);
                if (floors > 0) height = floors * 3.5;
            }

            // 3순위: 기본값
            if (height <= 0) height = 6.0;
            if (height > 600) height = 600;

            return new Cesium.Entity({
                polygon: {
                    hierarchy: positions,
                    extrudedHeight: height,
                    material: Cesium.Color.CYAN.withAlpha(0.6),
                    outline: true,
                    outlineColor: Cesium.Color.WHITE.withAlpha(0.4),
                    outlineWidth: 1
                }
            });
        } catch (e) { return null; }
    }

    // 화면 업데이트 (카메라 이동 시 호출)
    async updateVisibleTiles() {
        if (!this.isEnabled) return;
        
        // 1. DataSource 초기화 확인
        if (!this.dataSource) {
            this.dataSource = new Cesium.CustomDataSource('buildings');
            viewer.dataSources.add(this.dataSource);
        }

        const cameraPos = viewer.camera.positionCartographic;
        
        // 2. 줌 레벨 체크 (너무 높으면 로딩 중지)
        if (cameraPos.height > TILE_CONFIG.minZoomHeight) {
            this.hideAllBuildings();
            return;
        }

        // 3. 현재 위치 기준 주변 타일 계산
        const centerLon = Cesium.Math.toDegrees(cameraPos.longitude);
        const centerLat = Cesium.Math.toDegrees(cameraPos.latitude);
        const centerTileId = this.getTileId(centerLon, centerLat);

        const [baseX, baseY] = centerTileId.split('_').map(Number);
        const tilesToLoad = new Set();
        
        // 3x3 그리드 로딩
        for (let dx = -1; dx <= 1; dx++) {
            for (let dy = -1; dy <= 1; dy++) {
                tilesToLoad.add(`${baseX + dx}_${baseY + dy}`);
            }
        }

        // 4. 타일 로드 및 표시
        for (const tileId of tilesToLoad) {
            // 동시 로딩 수 제한
            if (!this.loadedTiles.has(tileId) && this.currentLoads >= TILE_CONFIG.maxConcurrentLoads) continue;

            // 로드 실행
            if (!this.loadedTiles.has(tileId)) {
                this.currentLoads++;
                this.loadTile(tileId).then(entities => {
                    if (this.dataSource) {
                        entities.forEach(e => {
                            if (!this.visibleEntities.has(e)) {
                                this.dataSource.entities.add(e);
                                this.visibleEntities.add(e);
                            }
                        });
                    }
                }).finally(() => this.currentLoads--);
            } 
            // 이미 로드된 타일 표시
            else {
                const entities = this.loadedTiles.get(tileId);
                entities.forEach(e => {
                    if (!this.visibleEntities.has(e) && this.dataSource) {
                        this.dataSource.entities.add(e);
                        this.visibleEntities.add(e);
                    }
                });
            }
        }

        // 5. 시야 밖의 타일 숨김 (메모리 관리)
        for (const [tileId, entities] of this.loadedTiles) {
            if (!tilesToLoad.has(tileId)) {
                entities.forEach(e => {
                    if (this.visibleEntities.has(e) && this.dataSource) {
                        this.dataSource.entities.remove(e);
                        this.visibleEntities.delete(e);
                    }
                });
                
                // (선택) 메모리 부족 시 오래된 캐시 삭제 로직을 여기에 추가 가능
            }
        }
    }

    hideAllBuildings() {
        if (this.dataSource) {
            this.dataSource.entities.removeAll();
            this.visibleEntities.clear();
        }
    }

    toggle() {
        this.isEnabled = !this.isEnabled;
        if (!this.isEnabled) this.hideAllBuildings();
        else this.updateVisibleTiles();
        return this.isEnabled;
    }
    
    clear() {
        if (this.dataSource) viewer.dataSources.remove(this.dataSource);
        this.loadedTiles.clear();
        this.visibleEntities.clear();
        this.dataSource = null;
    }
}
// ========================================
// 전역 인스턴스 생성
// ========================================
const buildingManager = new BuildingTileManager();

// 카메라 이동 시 타일 업데이트
let updateTimeout = null;
viewer.camera.moveEnd.addEventListener(function() {
    // 디바운스: 카메라 이동이 멈춘 후 0.5초 뒤 업데이트
    clearTimeout(updateTimeout);
    updateTimeout = setTimeout(() => {
        buildingManager.updateVisibleTiles();
    }, 500);
});

// ========================================
// 전역 제어 함수
// ========================================
function toggleBuildings() {
    const enabled = buildingManager.toggle();
    const msg = enabled ? "건물 표시 ON" : "건물 표시 OFF";
    console.log(msg);
    if (typeof showNotification === 'function') {
        showNotification(msg, "info");
    }
}

function clearBuildings() {
    buildingManager.clear();
    if (typeof showNotification === 'function') {
        showNotification("건물 제거됨", "info");
    }
}

function forceUpdateBuildings() {
    buildingManager.updateVisibleTiles();
    if (typeof showNotification === 'function') {
        showNotification("건물 업데이트 중...", "info");
    }
}

function resetCamera() {
    viewer.camera.flyTo({
        destination: Cesium.Cartesian3.fromDegrees(129.5505, 36.8220, 1500),
        orientation: {
            heading: Cesium.Math.toRadians(0.0),
            pitch: Cesium.Math.toRadians(-60.0),
            roll: 0.0
        },
        duration: 2
    });
}

// 전역 함수 등록
window.toggleBuildings = toggleBuildings;
window.clearBuildings = clearBuildings;
window.forceUpdateBuildings = forceUpdateBuildings;
window.resetCamera = resetCamera;
window.buildingManager = buildingManager;

// ========================================
// 초기 카메라 위치
// ========================================
viewer.camera.setView({
    // destination: Cesium.Cartesian3.fromDegrees(128.3, 36.1, 1500),
    destination: Cesium.Cartesian3.fromDegrees(128.3, 36.1, 2500),
    orientation: {
        heading: Cesium.Math.toRadians(0.0),
        // pitch: Cesium.Math.toRadians(-60.0),
        // roll: 0.0
        pitch: Cesium.Math.toRadians(-75), // 더 기울이기
        roll: 0
    }
});

// ========================================
// 에러 핸들링
// ========================================
window.addEventListener('error', function(event) {
    console.error('🚨 전역 에러:', event.error);
});

viewer.scene.renderError.addEventListener(function(scene, error) {
    console.error('🚨 렌더링 에러:', error);
});

// ========================================
// 초기화 완료
// ========================================
console.log("=".repeat(60));
console.log("✅ 타일 기반 건물 로딩 시스템 초기화 완료");
console.log("=".repeat(60));
console.log("📌 동작 방식:");
console.log("  - 고도 50km 이하에서 건물 자동 로드");
console.log("  - 현재 보이는 영역 + 주변 타일만 표시");
console.log("  - 카메라 이동 시 자동 업데이트");
console.log("=".repeat(60));
console.log("💡 설정 변경:");
console.log("  TILE_CONFIG.minZoomHeight: 건물 표시 시작 고도");
console.log("  TILE_CONFIG.tileLoadRadius: 타일 크기");
console.log("=".repeat(60));
console.log("💡 콘솔 명령어:");
console.log("  - toggleBuildings(): 건물 ON/OFF");
console.log("  - forceUpdateBuildings(): 강제 업데이트");
console.log("  - clearBuildings(): 건물 제거");
console.log("  - resetCamera(): 카메라 리셋");
console.log("=".repeat(60));