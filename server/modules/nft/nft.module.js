// import { NFTService } from './nft.service.js';

// export class NFTModule {
//     constructor(io, redisClient, db) {
//         this.io = io;
//         this.service = new NFTService(db);
//         console.log('⭐ NFT service ready');
//     }

//     setupSocketHandlers() {
//         this.io.on('connection', (socket) => {
//             console.log(`🔌 Client connected for NFTs: ${socket.id}`);

//             socket.on('get_user_nfts', async (userId) => {
//                 try {
//                     const nfts = await this.service.getUserNFTs(userId);
//                     socket.emit('user_nfts', { 
//                         success: true, 
//                         nfts,
//                         count: nfts.length
//                     });
//                 } catch (error) {
//                     socket.emit('user_nfts', { 
//                         success: false, 
//                         error: error.message 
//                     });
//                 }
//             });

//             socket.on('get_collections', async () => {
//                 try {
//                     const collections = await this.service.getCollections();
//                     socket.emit('collections_list', { 
//                         success: true, 
//                         collections 
//                     });
//                 } catch (error) {
//                     socket.emit('collections_list', { 
//                         success: false, 
//                         error: error.message 
//                     });
//                 }
//             });
//         });
//     }
// }