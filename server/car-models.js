const carModels = [
    ['DeLorean', 'delorean.webp', 0.5],
    ['Red Car', 'red-car.webp', 3],
    ['Orange Car', 'orange-car.webp', 2.5],
    ['Clown Car', 'clown-car.webp', 0.5],
    ['Spaceship', 'spaceship.webp', 0.5],
    ["Rick’s Spaceship", 'ricks-spaceship.webp', 0.5],
    ['Batmobile', 'batmobile.webp', 0.5],
    ['Sports Car', 'sports-car.webp', 0.5],
    ['Ecto-1', 'ecto-1.webp', 0.5],
    ['Boat Machine', 'boat-machine.webp', 0.5],
    ['Blue Car', 'blue-car.webp', 3],
    ['UFO', 'ufo.webp', 0.5],
    ['F1 Car', 'f1-car.webp', 0.5],
    ['Planet Express', 'planet-express.webp', 0.5],
    ['Panther Machine', 'panther-machine.webp', 0.5],
    ['USCSS Nostromo', 'uscss-nostromo.webp', 0.5],
    ['Boeing', 'boeing.webp', 0.5],
    ['Gray Car', 'gray-car.webp', 2.5],
    ['Pink Car', 'pink-car.webp', 3],
    ['Green Car', 'green-car.webp', 2.5]
];

export async function seedCarModels(db) {
    const collection = await db.get(
        `SELECT id FROM m_nft_collections
         WHERE lower(trim(name)) IN ('cars', 'car')
         ORDER BY CASE lower(trim(name)) WHEN 'cars' THEN 0 ELSE 1 END
         LIMIT 1`
    );
    if (!collection) {
        console.warn('Cars model catalog seed skipped: collection Cars/Car was not found.');
        return;
    }

    for (const [name, fileName, rarity] of carModels) {
        const existing = await db.get(
            `SELECT id FROM models WHERE collection_id = ? AND lower(name) = lower(?) LIMIT 1`,
            [collection.id, name]
        );
        if (existing) {
            await db.run(
                'UPDATE models SET file_name = ?, rarity = ? WHERE id = ?',
                [fileName, rarity, existing.id]
            );
        } else {
            await db.run(
                `INSERT INTO models (name, file_name, rarity, collection_id)
                 SELECT ?, ?, ?, ?
                 WHERE NOT EXISTS (
                     SELECT 1 FROM models WHERE collection_id = ? AND lower(name) = lower(?)
                 )`,
                [name, fileName, rarity, collection.id, collection.id, name]
            );
        }
    }
}

function modelFolder(name) {
    const value = String(name || '').trim();
    const aliases = {
        car: 'Cars', cars: 'Cars',
        cap: 'Cap', caps: 'Cap',
        pencil: 'Pencil', pencils: 'Pencil',
        pepe: 'Pepe', pepes: 'Pepe'
    };
    return aliases[value.toLowerCase()] || value;
}

export function getModelImagePath(collectionName, fileName) {
    if (!fileName) return '';
    const value = String(fileName).trim().replace(/\\/g, '/');
    if (/^https?:\/\//i.test(value)) return value;
    const raw = value.replace(/^\/+/, '').replace(/^m_nft_image\//i, '');
    const segments = raw.split('/').filter(part => part && part !== '.' && part !== '..');
    if (!segments.length) return '';
    if (segments.length === 1) {
        if (!collectionName) return '';
        segments.unshift(modelFolder(collectionName));
    } else {
        segments[0] = modelFolder(segments[0]);
    }
    const lastIndex = segments.length - 1;
    if (!/\.(png|webp|jpe?g|avif)$/i.test(segments[lastIndex])) {
        segments[lastIndex] += segments[0] === 'Cars' ? '.webp' : '.PNG';
    }
    return '/m_nft_image/' + segments.map(encodeURIComponent).join('/');
}
