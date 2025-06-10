const mongoose = require('mongoose');

const assetSchema = new mongoose.Schema({
  uniqueName: {
    type: String,
    required: true,
    unique: true,
  },
  originalName: {
    type: String,
    required: true,
  },
  mimetype: {
    type: String,
    required: true,
  },
  size: {
    type: Number,
    required: true,
  },
  uploadDate: {
    type: Date,
    default: Date.now,
  },
  views: {
    type: Number,
    default: 0,
  },
  downloads: {
    type: Number,
    default: 0,
  },
  // You can add more fields here like 'uploaderId' etc.
});

module.exports = mongoose.model('Asset', assetSchema); 