const axios = require('axios');

class GitHubService {
  constructor() {
    this.baseURL = 'https://api.github.com';
  }

  // Get user's repositories (both public and private)
  async getUserRepositories(accessToken, options = {}) {
    const { page = 1, perPage = 100, search = '', type = 'all' } = options;
    
    try {
      // Fetch all repositories in batches to get complete list
      let allRepos = [];
      let currentPage = 1;
      let hasMore = true;
      
              while (hasMore && currentPage <= 10) { // Limit to 10 pages (1000 repos max)
        const response = await axios.get(`${this.baseURL}/user/repos`, {
          headers: {
            'Authorization': `token ${accessToken}`,
            'Accept': 'application/vnd.github.v3+json'
          },
          params: {
            page: currentPage,
            per_page: 100, // Maximum per page
            sort: 'updated',
            direction: 'desc',
            affiliation: 'owner,collaborator' // Include owned and collaborated repos
            // Note: Cannot use 'type' parameter with 'affiliation' - GitHub API limitation
          }
        });

        const repos = response.data.map(repo => ({
          id: repo.id,
          name: repo.name,
          fullName: repo.full_name,
          description: repo.description || '',
          private: repo.private,
          owner: repo.owner.login,
          url: repo.html_url,
          cloneUrl: repo.clone_url,
          sshUrl: repo.ssh_url,
          defaultBranch: repo.default_branch,
          language: repo.language,
          stargazersCount: repo.stargazers_count,
          forksCount: repo.forks_count,
          updatedAt: repo.updated_at,
          createdAt: repo.created_at,
          size: repo.size,
          fork: repo.fork
        }));

        allRepos = allRepos.concat(repos);
        
        // Check if there are more pages
        hasMore = response.data.length === 100;
        currentPage++;
      }

      // Filter by search term if provided
      if (search) {
        const searchLower = search.toLowerCase();
        allRepos = allRepos.filter(repo => 
          repo.name.toLowerCase().includes(searchLower) ||
          repo.fullName.toLowerCase().includes(searchLower) ||
          repo.description.toLowerCase().includes(searchLower) ||
          (repo.language && repo.language.toLowerCase().includes(searchLower))
        );
      }

      // Filter by type if specified
      if (type === 'public') {
        allRepos = allRepos.filter(repo => !repo.private);
      } else if (type === 'private') {
        allRepos = allRepos.filter(repo => repo.private);
      }

      // Apply pagination to filtered results
      const startIndex = (page - 1) * perPage;
      const endIndex = startIndex + perPage;
      const paginatedRepos = allRepos.slice(startIndex, endIndex);

      return {
        repositories: paginatedRepos,
        pagination: {
          page,
          perPage,
          total: allRepos.length,
          totalPages: Math.ceil(allRepos.length / perPage),
          hasNext: endIndex < allRepos.length,
          hasPrev: page > 1
        },
        filters: {
          search,
          type,
          totalPublic: allRepos.filter(repo => !repo.private).length,
          totalPrivate: allRepos.filter(repo => repo.private).length
        }
      };
    } catch (error) {
      console.error('Error fetching repositories:', error.response?.data || error.message);
      throw new Error('Failed to fetch repositories from GitHub');
    }
  }

  // Get specific repository details
  async getRepository(accessToken, owner, repo) {
    try {
      const response = await axios.get(`${this.baseURL}/repos/${owner}/${repo}`, {
        headers: {
          'Authorization': `token ${accessToken}`,
          'Accept': 'application/vnd.github.v3+json'
        }
      });

      const repoData = response.data;
      return {
        id: repoData.id,
        name: repoData.name,
        fullName: repoData.full_name,
        description: repoData.description,
        private: repoData.private,
        owner: repoData.owner.login,
        url: repoData.html_url,
        cloneUrl: repoData.clone_url,
        sshUrl: repoData.ssh_url,
        defaultBranch: repoData.default_branch,
        language: repoData.language,
        stargazersCount: repoData.stargazers_count,
        forksCount: repoData.forks_count,
        updatedAt: repoData.updated_at,
        createdAt: repoData.created_at
      };
    } catch (error) {
      console.error('Error fetching repository:', error.response?.data || error.message);
      throw new Error('Failed to fetch repository details from GitHub');
    }
  }

  // Get repository branches
  async getRepositoryBranches(accessToken, owner, repo) {
    try {
      const response = await axios.get(`${this.baseURL}/repos/${owner}/${repo}/branches`, {
        headers: {
          'Authorization': `token ${accessToken}`,
          'Accept': 'application/vnd.github.v3+json'
        }
      });

      return response.data.map(branch => ({
        name: branch.name,
        commit: {
          sha: branch.commit.sha,
          url: branch.commit.url
        },
        protected: branch.protected
      }));
    } catch (error) {
      console.error('Error fetching branches:', error.response?.data || error.message);
      throw new Error('Failed to fetch repository branches from GitHub');
    }
  }

  // Get latest commit for a branch
  async getLatestCommit(accessToken, owner, repo, branch = 'main') {
    try {
      const response = await axios.get(`${this.baseURL}/repos/${owner}/${repo}/commits/${branch}`, {
        headers: {
          'Authorization': `token ${accessToken}`,
          'Accept': 'application/vnd.github.v3+json'
        }
      });

      const commit = response.data;
      return {
        sha: commit.sha,
        message: commit.commit.message,
        author: {
          name: commit.commit.author.name,
          email: commit.commit.author.email,
          date: commit.commit.author.date
        },
        committer: {
          name: commit.commit.committer.name,
          email: commit.commit.committer.email,
          date: commit.commit.committer.date
        },
        url: commit.html_url
      };
    } catch (error) {
      console.error('Error fetching latest commit:', error.response?.data || error.message);
      throw new Error('Failed to fetch latest commit from GitHub');
    }
  }

  // Check if repository exists and is accessible
  async checkRepositoryAccess(accessToken, owner, repo) {
    try {
      await axios.get(`${this.baseURL}/repos/${owner}/${repo}`, {
        headers: {
          'Authorization': `token ${accessToken}`,
          'Accept': 'application/vnd.github.v3+json'
        }
      });
      return true;
    } catch (error) {
      if (error.response?.status === 404) {
        return false;
      }
      throw error;
    }
  }

  // Get user profile
  async getUserProfile(accessToken) {
    try {
      const response = await axios.get(`${this.baseURL}/user`, {
        headers: {
          'Authorization': `token ${accessToken}`,
          'Accept': 'application/vnd.github.v3+json'
        }
      });

      return response.data;
    } catch (error) {
      console.error('Error fetching user profile:', error.response?.data || error.message);
      throw new Error('Failed to fetch user profile from GitHub');
    }
  }
}

module.exports = new GitHubService(); 