require('dotenv').config();
const express = require('express');
const mongoose = require('mongoose');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const path = require('path');
const multer = require('multer');
const crypto = require('crypto');
const Asset = require('./models/Asset');
const session = require('express-session');
const fs = require('fs');

const app = express();
const PORT = process.env.PORT || 3000;
const MONGO_URI = process.env.MONGO_URI || 'mongodb://localhost:27017/ryzoassets';
const WEBSITE_ACCESS_KEY = process.env.WEBSITE_ACCESS_KEY || 'default_website_key'; // This will now serve as the main API key too

// Connect to MongoDB
mongoose.connect(MONGO_URI)
  .then(() => console.log('MongoDB Connected'))
  .catch(err => console.error('MongoDB connection error:', err));

// Session middleware
app.use(session({
  secret: process.env.SESSION_SECRET || 'supersecretkey', // CHANGE THIS TO A STRONG, RANDOM KEY IN .ENV
  resave: false,
  saveUninitialized: true,
  cookie: { secure: process.env.NODE_ENV === 'production' } // Use secure cookies in production
}));

// Middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Helmet for security headers, allowing inline scripts temporarily (will fix more securely later)
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'", "'unsafe-inline'"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      imgSrc: ["'self'", "data:"],
      mediaSrc: ["'self'"],
      objectSrc: ["'none'"],
      upgradeInsecureRequests: [],
    },
  },
}));

// Rate limiting
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100, // max 100 requests per 15 minutes per IP
  message: 'Too many requests from this IP, please try again after 15 minutes'
});
app.use(limiter);

// Set EJS as view engine
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

// Serve static files (for CSS, JS, etc.)
app.use(express.static(path.join(__dirname, 'public')));

// Set up multer for file uploads
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, 'uploads/');
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = crypto.randomBytes(16).toString('hex');
    const fileExtension = path.extname(file.originalname);
    cb(null, uniqueSuffix + fileExtension);
  },
});
const upload = multer({ storage: storage });

// Middleware for API Key authentication (for uploads/deletions/direct API access)
const authenticateApiKey = (req, res, next) => {
  if (req.session.isAuthenticated) { // If already authenticated via website, allow
    return next();
  }

  const apiKey = req.headers['x-api-key'] || req.query.api_key || req.body.api_key;

  if (!apiKey || apiKey !== WEBSITE_ACCESS_KEY) { // Compare with WEBSITE_ACCESS_KEY
    return res.status(401).json({ message: 'Unauthorized: Invalid API Key' });
  }
  next();
};

// Middleware for website access authentication (for rendering pages)
const authenticateWebsiteAccess = (req, res, next) => {
  // Allow access to login page and authentication route without session
  if (req.session.isAuthenticated || req.path === '/' || req.path === '/authenticate-website-access') {
    next();
  } else {
    res.redirect('/');
  }
};

// Apply website access authentication to all routes except the login and auth routes that are handled explicitly
app.use(authenticateWebsiteAccess);

// Routes
app.get('/', (req, res) => {
  if (req.session.isAuthenticated) {
    res.render('index', { title: 'Ryzo Assets - Home', isAuthenticated: true });
  } else {
    res.render('access_key_form', { title: 'Enter Access Key', error: null });
  }
});

app.post('/authenticate-website-access', (req, res) => {
  const { accessKey } = req.body;
  if (accessKey === WEBSITE_ACCESS_KEY) {
    req.session.isAuthenticated = true;
    res.redirect('/');
  } else {
    res.render('access_key_form', { title: 'Enter Access Key', error: 'Invalid Access Key' });
  }
});

// Upload Route
app.post('/upload', authenticateApiKey, upload.single('asset'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ message: 'No file uploaded' });
    }

    const newAsset = new Asset({
      uniqueName: req.file.filename,
      originalName: req.file.originalname,
      mimetype: req.file.mimetype,
      size: req.file.size,
    });

    await newAsset.save();

    res.status(201).render('upload_success', {
      title: 'Upload Successful',
      originalName: req.file.originalname,
      uniqueName: req.file.filename,
      mimetype: req.file.mimetype,
      size: req.file.size,
      fileUrl: `${req.protocol}://${req.get('host')}/${req.file.filename}`,
      viewUrl: `${req.protocol}://${req.get('host')}/${req.file.filename}?view=true`,
    });
  } catch (error) {
    console.error('Error uploading file:', error);
    res.status(500).json({ message: 'Server error during file upload' });
  }
});

// File Serving Route
app.get('/:uniqueName', authenticateWebsiteAccess, async (req, res) => {
  try {
    const uniqueName = req.params.uniqueName;
    const asset = await Asset.findOne({ uniqueName: uniqueName });

    if (!asset) {
      return res.status(404).render('404', { title: 'File Not Found' });
    }

    const filePath = path.join(__dirname, 'uploads', asset.uniqueName);
    const viewMode = req.query.view === 'true';

    if (viewMode) {
      // Increment views count
      asset.views = (asset.views || 0) + 1;
      await asset.save();

      res.render('view_asset', {
        title: asset.originalName,
        asset: asset,
        fileUrl: `/${asset.uniqueName}`
      });
    } else {
      // Increment downloads count
      asset.downloads = (asset.downloads || 0) + 1;
      await asset.save();

      // Stream/Download the file
      res.setHeader('Content-Type', asset.mimetype);
      if (asset.mimetype.startsWith('image/') || asset.mimetype.startsWith('video/') || asset.mimetype.startsWith('audio/')) {
        res.setHeader('Content-Disposition', `inline; filename="${asset.originalName}"`);
      } else {
        res.setHeader('Content-Disposition', `attachment; filename="${asset.originalName}"`);
      }
      res.sendFile(filePath);
    }

  } catch (error) {
    console.error('Error serving file:', error);
    res.status(500).json({ message: 'Server error serving file' });
  }
});

// API to get recent assets
app.get('/api/recent-assets', authenticateWebsiteAccess, async (req, res) => {
  try {
    const recentAssets = await Asset.find().sort({ uploadDate: -1 }).limit(10);
    res.json(recentAssets);
  } catch (error) {
    console.error('Error fetching recent assets:', error);
    res.status(500).json({ message: 'Server error fetching recent assets' });
  }
});

// API to search assets
app.get('/api/search-assets', authenticateWebsiteAccess, async (req, res) => {
  try {
    const query = req.query.q;
    if (!query) {
      return res.status(400).json({ message: 'Search query is required' });
    }

    const searchResults = await Asset.find({
      $or: [
        { originalName: { $regex: query, $options: 'i' } },
        { uniqueName: { $regex: query, $options: 'i' } }
      ]
    }).limit(20);

    res.json(searchResults);

  } catch (error) {
    console.error('Error searching assets:', error);
    res.status(500).json({ message: 'Server error searching assets' });
  }
});

// API to get all assets with pagination
app.get('/api/all-assets', authenticateWebsiteAccess, async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 10; // Default to 10 assets per page
    const skip = (page - 1) * limit;

    const totalAssets = await Asset.countDocuments();
    const allAssets = await Asset.find().sort({ uploadDate: -1 }).skip(skip).limit(limit);

    res.json({
      assets: allAssets,
      totalPages: Math.ceil(totalAssets / limit),
      currentPage: page,
      totalAssets: totalAssets
    });
  } catch (error) {
    console.error('Error fetching all assets:', error);
    res.status(500).json({ message: 'Server error fetching all assets' });
  }
});

// Route for the All Files page
app.get('/all-files', authenticateWebsiteAccess, (req, res) => {
  res.render('all_files', { title: 'All Hosted Assets' });
});

// API to delete an asset
app.delete('/api/asset/:uniqueName', authenticateApiKey, async (req, res) => {
  try {
    const uniqueName = req.params.uniqueName;

    const asset = await Asset.findOneAndDelete({ uniqueName: uniqueName });

    if (!asset) {
      return res.status(404).json({ message: 'Asset not found' });
    }

    // Delete the physical file from the uploads directory
    const filePath = path.join(__dirname, 'uploads', asset.uniqueName);
    fs.unlink(filePath, (err) => {
      if (err) {
        console.error('Error deleting physical file:', err);
        return res.status(500).json({ message: 'Asset metadata deleted, but physical file deletion failed.', error: err.message });
      }
      console.log(`Physical file ${asset.uniqueName} deleted.`);
    });

    res.status(200).json({ message: 'Asset deleted successfully' });
  } catch (error) {
    console.error('Error deleting asset:', error);
    res.status(500).json({ message: 'Server error deleting asset' });
  }
});

// Start the server
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
}); 