const express = require('express');
const githubService = require('../services/github');
const router = express.Router();

// Get user repositories with search and filtering
router.get('/', async (req, res) => {
  try {
    const options = {
      page: parseInt(req.query.page) || 1,
      perPage: parseInt(req.query.per_page) || 30,
      search: req.query.search || '',
      type: req.query.type || 'all' // 'all', 'public', 'private'
    };
    
    const result = await githubService.getUserRepositories(
      req.user.accessToken, 
      options
    );
    
    res.json(result);
  } catch (error) {
    console.error('Error fetching repositories:', error);
    res.status(500).json({ error: 'Failed to fetch repositories' });
  }
});

// Get specific repository
router.get('/:owner/:repo', async (req, res) => {
  try {
    const { owner, repo } = req.params;
    
    const repository = await githubService.getRepository(
      req.user.accessToken, 
      owner, 
      repo
    );
    
    res.json({ repository });
  } catch (error) {
    console.error('Error fetching repository:', error);
    res.status(500).json({ error: 'Failed to fetch repository' });
  }
});

// Get repository branches
router.get('/:owner/:repo/branches', async (req, res) => {
  try {
    const { owner, repo } = req.params;
    
    const branches = await githubService.getRepositoryBranches(
      req.user.accessToken, 
      owner, 
      repo
    );
    
    res.json({ branches });
  } catch (error) {
    console.error('Error fetching branches:', error);
    res.status(500).json({ error: 'Failed to fetch branches' });
  }
});

// Get latest commit
router.get('/:owner/:repo/commits/:branch?', async (req, res) => {
  try {
    const { owner, repo, branch } = req.params;
    
    const commit = await githubService.getLatestCommit(
      req.user.accessToken, 
      owner, 
      repo, 
      branch
    );
    
    res.json({ commit });
  } catch (error) {
    console.error('Error fetching commit:', error);
    res.status(500).json({ error: 'Failed to fetch commit' });
  }
});

module.exports = router; 